import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

import { createGrepTool } from "./tools/grep.js";
import { createGlobTool } from "./tools/glob.js";

export default function registerGrepGlobTools(pi: ExtensionAPI) {
  pi.registerTool(createGrepTool());
  pi.registerTool(createGlobTool());
}
