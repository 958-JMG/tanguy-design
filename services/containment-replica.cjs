const nativeFetch = global.fetch;
global.fetch = (url, options) => nativeFetch(String(url).replace('https://api.airtable.com', process.env.FIXTURE_ORIGIN), options);
let app;
if (process.argv.includes('--legacy')) {
  const path=require('node:path'),Module=require('node:module'),{execFileSync}=require('node:child_process');
  const root=path.resolve(__dirname,'..'),filename=path.join(root,'server.js');
  const original=execFileSync('git',['show','1098a9a4f6cfb76d22aa565af4511a4142a010e1:server.js'],{cwd:root,encoding:'utf8'});
  const legacy=new Module(filename,module);legacy.filename=filename;legacy.paths=Module._nodeModulePaths(root);legacy._compile(original,filename);app=legacy.exports;
} else app=require('../server');
const server = app.listen(0, '127.0.0.1', () => process.send({ port: server.address().port }));
