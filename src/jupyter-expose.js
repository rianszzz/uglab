// jupyter-expose.js — runs in the page (MAIN world) at document_start on jupyter.org (try-jupyter / JupyterLite).
// 1) JupyterLite builds its config from jupyter-lite.json, so exposeAppInBrowser is injected there to get window.jupyterapp.
// 2) __uglabPreflight(): before Run All, silently install (no cell is written) the imports the Pyodide kernel doesn't ship.
(() => {
  const of = window.fetch;
  window.fetch = async function (...a) {
    const r = await of.apply(this, a);
    try {
      if (/jupyter-lite\.json(\?|$)/.test(String(a[0]?.url || a[0]))) {
        const j = await r.clone().json();
        j["jupyter-config-data"] = { ...j["jupyter-config-data"], exposeAppInBrowser: true };
        return new Response(JSON.stringify(j), { status: r.status, headers: r.headers });
      }
    } catch { }
    return r;
  };

  // pyodide_js.loadPackagesFromImports covers the bundled wheels (numpy/pandas/scipy/matplotlib...);
  // only what is STILL not importable afterwards (e.g. seaborn) goes to micropip, so installed libs are never touched.
  const PY = `
import ast, json, importlib.util as _u
import pyodide_js, micropip
_PIP = {"sklearn": "scikit-learn", "cv2": "opencv-python", "PIL": "pillow", "yaml": "pyyaml", "bs4": "beautifulsoup4"}
_mods = set()
for _c in json.loads(_cells):
    try:
        for _n in ast.walk(ast.parse("\\n".join(l for l in _c.split("\\n") if not l.lstrip().startswith(("%", "!"))))):
            if isinstance(_n, ast.Import): _mods.update(a.name.split(".")[0] for a in _n.names)
            elif isinstance(_n, ast.ImportFrom) and _n.level == 0 and _n.module: _mods.add(_n.module.split(".")[0])
    except SyntaxError:
        pass
await pyodide_js.loadPackagesFromImports("\\n".join("import " + _m for _m in _mods))
for _m in sorted(_mods):
    if _u.find_spec(_m) is None:
        try: await micropip.install(_PIP.get(_m, _m))
        except Exception as _e: print("uglab: cannot install", _m, _e)
# Pyodide has no sockets: pd.read_csv("https://...") dies with "URLError: [Errno 23] Host is unreachable" unless urllib/requests are routed through fetch
try:
    if _u.find_spec("pyodide_http") is None: await micropip.install("pyodide-http")
    import pyodide_http; pyodide_http.patch_all()
except Exception as _e: print("uglab: cannot patch http", _e)
`;

  window.__uglabPreflight = async () => {
    const w = window.jupyterapp?.shell?.currentWidget;
    const k = w?.sessionContext?.session?.kernel;
    if (!k || k.name !== "python") return; // ponytail: Pyodide kernel only; other kernels already have their packages
    const cells = (w.content?.widgets || []).filter(c => c.model?.type === "code").map(c => c.model.sharedModel.getSource());
    await k.requestExecute({ code: `_cells = ${JSON.stringify(JSON.stringify(cells))}\n${PY}`, silent: true, store_history: false }).done;
  };
})();
