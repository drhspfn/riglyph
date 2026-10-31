import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import {resolve,relative,isAbsolute} from 'node:path';
import {fileURLToPath} from 'node:url';
const project=resolve(fileURLToPath(new URL('../../../',import.meta.url)));
const root=resolve(project,'dist/src');
const mime:Record<string,string>={'.js':'text/javascript; charset=utf-8','.json':'application/json','.html':'text/html; charset=utf-8','.png':'image/png'};
const port=Number(process.env['PORT']??'5173');
createServer(async(req,res)=>{
 const url=new URL(req.url??'/',`http://localhost:${port}`);
 try{
  let file:string;
  if(url.pathname==='/')file=resolve(project,'src/playground/index.html');
  else if(url.pathname==='/fixture/minimal.json')file=resolve(project,'fixtures/minimal.json');
  else if(url.pathname==='/fixture/synthetic-example.png')file=resolve(project,'fixtures/synthetic-example.png');
  else if(url.pathname.startsWith('/engine/')){
   file=resolve(root,url.pathname.slice('/engine/'.length));
   if(relative(root,file).startsWith('..')||isAbsolute(relative(root,file))){res.writeHead(403).end('Forbidden');return;}
  }else if(url.pathname.startsWith('/pkg/')){
   const parts=url.pathname.split('/').slice(2);
   const packageName=parts.shift()??'';
   if(!['core','runtime','renderer-webgl2','player-web'].includes(packageName)){res.writeHead(403).end('Forbidden');return;}
   const base=resolve(project,'packages',packageName,'dist');file=resolve(base,parts.join('/'));
   if(relative(base,file).startsWith('..')||isAbsolute(relative(base,file))){res.writeHead(403).end('Forbidden');return;}
  }else{res.writeHead(404).end('Not Found');return;}
  const data=await readFile(file);
  const ext=file.slice(file.lastIndexOf('.'));
  res.writeHead(200,{'Content-Type':mime[ext]??'application/octet-stream','Cache-Control':'no-cache','X-Content-Type-Options':'nosniff'});res.end(data);
 }catch{res.writeHead(404).end('Not Found');}
}).listen(port,'127.0.0.1',()=>process.stdout.write(`Playground http://127.0.0.1:${port}\n`));
