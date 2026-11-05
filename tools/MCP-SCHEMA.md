# Local MCP schema validator

`js/vendor/mcp_schema.js` is built from `tools/mcp-schema.entry.cjs`. There is no runtime CDN request.

Pinned build packages: ajv 8.17.1, ajv-formats 3.0.1, esbuild 0.25.12. Install these into a scratch directory, then use that directory's esbuild API:

```js
require('esbuild').buildSync({
  entryPoints: ['tools/mcp-schema.entry.cjs'],
  outfile: 'js/vendor/mcp_schema.js',
  nodePaths: ['<scratch>/node_modules'],
  bundle: true, minify: true, platform: 'browser', target: ['es2020'],
  legalComments: 'inline',
  banner: { js: '/* MCP schema bundle: Ajv 8.17.1 + ajv-formats 3.0.1 (MIT). See MCP-SCHEMA-LICENSES.txt. */' }
});
```

Draft 2020-12 and explicit draft-07 supported, no coercion or remote schema fetch. To keep untrusted schemas bounded, this feature rejects regular-expression schema keywords, dynamic/recursive refs, nested reference scopes, unknown formats, other drafts and unsafe property names. Expanded reference work is capped at 2000 schema nodes. Schemas are at most 64 KiB/depth 16/2500 nodes; input at most 32 KiB. A rejected tool is shown as unavailable with its reason. This is a deliberately bounded subset, not a claim that every MCP tool is compatible.
