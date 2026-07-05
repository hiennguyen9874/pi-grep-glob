//! Minimal blocking task and cancellation support for this N-API crate.

use std::{
	panic::{AssertUnwindSafe, catch_unwind},
	sync::{
		Arc,
		atomic::{AtomicBool, Ordering},
	},
	time::{Duration, Instant},
};

use napi::{Env, Error, Result, Status, Task, bindgen_prelude::*};

/// Cooperative cancellation token for blocking native work.
#[derive(Clone, Default)]
pub struct CancelToken {
	state: Arc<CancelState>,
}

#[derive(Default)]
struct CancelState {
	aborted: AtomicBool,
	deadline: Option<Instant>,
}

impl From<()> for CancelToken {
	fn from((): ()) -> Self {
		Self::default()
	}
}

impl CancelToken {
	/// Create a cancel token with an optional timeout and JS abort signal.
	pub fn new(timeout_ms: Option<u32>, signal: Option<Unknown>) -> Self {
		let token = Self {
			state: Arc::new(CancelState {
				aborted: AtomicBool::new(false),
				deadline: timeout_ms.map(|ms| Instant::now() + Duration::from_millis(u64::from(ms))),
			}),
		};

		if let Some(signal) = signal.and_then(|value| AbortSignal::from_unknown(value).ok()) {
			let abort_token = token.clone();
			signal.on_abort(move || abort_token.abort());
		}

		token
	}

	/// Return an error if timeout or abort cancellation has been requested.
	pub fn heartbeat(&self) -> Result<()> {
		if self.aborted() {
			return Err(Error::new(Status::Cancelled, "Operation cancelled"));
		}
		if let Some(deadline) = self.state.deadline
			&& Instant::now() >= deadline
		{
			self.state.aborted.store(true, Ordering::SeqCst);
			return Err(Error::new(Status::Cancelled, "Timeout"));
		}
		Ok(())
	}

	/// Check whether cancellation has already been requested.
	pub fn aborted(&self) -> bool {
		self.state.aborted.load(Ordering::SeqCst)
	}

	fn abort(&self) {
		self.state.aborted.store(true, Ordering::SeqCst);
	}
}

/// Blocking libuv task wrapper used by exported native functions.
pub struct Blocking<T>
where
	T: Send + 'static,
{
	tag:          &'static str,
	cancel_token: CancelToken,
	work:         Option<Box<dyn FnOnce(CancelToken) -> Result<T> + Send>>,
}

impl<T> Task for Blocking<T>
where
	T: ToNapiValue + Send + 'static + TypeName,
{
	type JsValue = T;
	type Output = T;

	fn compute(&mut self) -> Result<Self::Output> {
		let work = self
			.work
			.take()
			.ok_or_else(|| Error::from_reason("Blocking task work already consumed"))?;
		let cancel_token = self.cancel_token.clone();
		let tag = self.tag;
		match catch_unwind(AssertUnwindSafe(move || work(cancel_token))) {
			Ok(result) => result,
			Err(payload) => Err(Error::new(
				Status::GenericFailure,
				format!("native task `{tag}` panicked: {}", panic_message(&*payload)),
			)),
		}
	}

	fn resolve(&mut self, _env: Env, output: Self::Output) -> Result<Self::JsValue> {
		Ok(output)
	}
}

fn panic_message(payload: &(dyn std::any::Any + Send)) -> String {
	if let Some(message) = payload.downcast_ref::<&str>() {
		(*message).to_string()
	} else if let Some(message) = payload.downcast_ref::<String>() {
		message.clone()
	} else {
		"non-string panic payload".to_string()
	}
}

pub type Promise<T> = AsyncTask<Blocking<T>>;

/// Create an async N-API task around blocking Rust work.
pub fn blocking<T, F>(
	tag: &'static str,
	cancel_token: impl Into<CancelToken>,
	work: F,
) -> AsyncTask<Blocking<T>>
where
	T: ToNapiValue + Send + 'static + TypeName,
	F: FnOnce(CancelToken) -> Result<T> + Send + 'static,
{
	AsyncTask::new(Blocking {
		tag,
		cancel_token: cancel_token.into(),
		work: Some(Box::new(work)),
	})
}
