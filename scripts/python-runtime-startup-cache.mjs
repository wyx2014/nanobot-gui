import { execFileSync } from 'child_process';

export const DESKTOP_STARTUP_MODULES = Object.freeze([
  'nanobot.cli.commands',
  'nanobot.channels.websocket',
  'mcp',
  'mcp.client.sse',
  'mcp.client.stdio',
  'mcp.client.streamable_http',
  'openai',
]);

const STARTUP_CACHE_CODE = [
  'import importlib',
  'import pathlib',
  'import py_compile',
  'import sys',
  `startup_modules = ${JSON.stringify(DESKTOP_STARTUP_MODULES)}`,
  'for module_name in startup_modules:',
  '    importlib.import_module(module_name)',
  "getattr(sys.modules['openai'], 'AsyncOpenAI')",
  'runtime_root = pathlib.Path(sys.prefix).resolve()',
  'sources = set()',
  'for module in tuple(sys.modules.values()):',
  "    raw_path = getattr(module, '__file__', '') or ''",
  "    if not raw_path.endswith('.py'):",
  '        continue',
  '    source_path = pathlib.Path(raw_path).resolve()',
  '    if not source_path.is_relative_to(runtime_root):',
  '        continue',
  '    sources.add(source_path)',
  'for source_path in sorted(sources):',
  '    py_compile.compile(',
  '        str(source_path),',
  '        doraise=True,',
  '        invalidation_mode=py_compile.PycInvalidationMode.UNCHECKED_HASH,',
  '    )',
  "print(f'Precompiled {len(sources)} desktop startup modules with unchecked-hash bytecode.')",
].join('\n');

export function precompileDesktopStartupModules(pythonBin) {
  const env = {
    ...process.env,
    NANOBOT_DESKTOP_GATEWAY: '1',
    PYTHONNOUSERSITE: '1',
  };
  // Bytecode must land beside the embedded runtime sources so it is included
  // in the installer rather than redirected to a developer-specific cache.
  delete env.PYTHONPATH;
  delete env.PYTHONPYCACHEPREFIX;
  delete env.PYTHONDONTWRITEBYTECODE;

  execFileSync(pythonBin, ['-c', STARTUP_CACHE_CODE], {
    env,
    stdio: 'inherit',
  });
}
