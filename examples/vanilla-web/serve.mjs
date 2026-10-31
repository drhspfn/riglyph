// Tiny dependency-free static server for this local QA sample only.
import {createServer} from 'node:http';
import {readFile,stat} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {resolve,dirname,sep,extname} from 'node:path';
const root=dirname(fileURLToPath(import.meta.url));
const mime={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.json':'application/json; charset=utf-8','.png':'image/png','.map':'application/json; charset=utf-8'};
const host='127.0.0.1',port=Number(process.env['PORT']??8080);
createServer(async(req,res)=>{
 try{
  const url=new URL(req.url??'/',`http://${host}:${port}`);
  if(req.method!=='GET'&&req.method!=='HEAD'){res.writeHead(405);res.end();return;}
  const relative=decodeURIComponent(url.pathname);
  const path=resolve(root,'.'+relative.replace(/\/$/,'/index.html'));
  if(path!==root&&!path.startsWith(root+sep)){res.writeHead(403);res.end();return;}
  const info=await stat(path);if(!info.isFile()){res.writeHead(404);res.end();return;}
  const data=await readFile(path);
  res.writeHead(200,{'content-type':mime[extname(path)]??'application/octet-stream','content-length':data.length,'x-content-type-options':'nosniff'});
  res.end(req.method==='HEAD'?undefined:data);
 }catch{res.writeHead(404);res.end();}
}).listen(port,host,()=>console.log(`Vanilla example: http://${host}:${port}`));
