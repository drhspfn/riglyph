/** Version-neutral cubic path geometry. All coordinates are world-space.
 * Keeps source-provided nonconstant curve lengths separate from measured arclength.
 * This is independent numerical code, not a port of a vendor runtime.
 */
export type PathPoint={x:number;y:number;angle:number};
type XY={x:number;y:number};
type Curve={a:XY;b:XY;c:XY;d:XY;table:number[];total:number};
const EPS=1e-9;
const coords=(data:Float32Array,i:number):XY=>({x:data[i*2]!,y:data[i*2+1]!});
function bezier(q:Curve,t:number):XY{
 const u=1-t,uu=u*u,tt=t*t;
 return {x:uu*u*q.a.x+3*uu*t*q.b.x+3*u*tt*q.c.x+tt*t*q.d.x,
  y:uu*u*q.a.y+3*uu*t*q.b.y+3*u*tt*q.c.y+tt*t*q.d.y};
}
function derivative(q:Curve,t:number):XY{
 const u=1-t;
 return {x:3*u*u*(q.b.x-q.a.x)+6*u*t*(q.c.x-q.b.x)+3*t*t*(q.d.x-q.c.x),
  y:3*u*u*(q.b.y-q.a.y)+6*u*t*(q.c.y-q.b.y)+3*t*t*(q.d.y-q.c.y)};
}
function angle(q:Curve,t:number):number{
 const d=derivative(q,t);
 if(Math.hypot(d.x,d.y)>EPS)return Math.atan2(d.y,d.x);
 const near=bezier(q,Math.max(0,Math.min(1,t+1e-4))),p=bezier(q,Math.max(0,Math.min(1,t-1e-4)));
 return Math.atan2(near.y-p.y,near.x-p.x);
}
const STEPS=96;
export class CubicWorldPath {
 private readonly curves:Curve[]=[];
 private readonly cumulative:number[]=[0];
 readonly total:number;
 constructor(points:Float32Array,readonly closed:boolean,readonly constantSpeed:boolean,authoredLengths:readonly number[]){
  const n=points.length/2;
  if(!Number.isInteger(n)||n<4)throw new RangeError('Path needs at least four control vertices');
  // Open Spine-style paths include a leading and trailing control vertex used
  // for endpoint extension. Four-vertex IR paths are accepted directly.
  const starts:number[]=[];
  if(closed){for(let i=1;i<n+1;i+=3)starts.push(i);}
  else if(n===4)starts.push(0);
  else{for(let i=1;i+3<n-1;i+=3)starts.push(i);}
  if(starts.length===0)starts.push(0);
  for(let k=0;k<starts.length;k++){
   const s=starts[k]!;
   const get=(i:number)=>coords(points,closed?(i%n):Math.min(n-1,i));
   const q:Curve={a:get(s),b:get(s+1),c:get(s+2),d:get(s+3),table:[0],total:0};
   let previous=q.a;
   for(let i=1;i<=STEPS;i++){
    const current=bezier(q,i/STEPS);
    q.table.push(q.table[i-1]!+Math.hypot(current.x-previous.x,current.y-previous.y));
    previous=current;
   }
   q.total=q.table.at(-1)!;
   const authored=authoredLengths[k];
   const previousEnd=k?authoredLengths[k-1]??0:0;
   const length=!constantSpeed&&Number.isFinite(authored)&&authored!>previousEnd?authored!-previousEnd:q.total;
   this.curves.push(q);this.cumulative.push(this.cumulative.at(-1)!+Math.max(0,length));
  }
  this.total=this.cumulative.at(-1)!;
 }
 sample(distance:number):PathPoint{
  if(!Number.isFinite(distance))throw new RangeError('Nonfinite path distance');
  if(this.total<EPS){
   const first=this.curves[0]!,p=first.a;
   const theta=angle(first,0);
   const distanceAlong=!this.closed?distance:0;
   return{x:p.x+Math.cos(theta)*distanceAlong,
    y:p.y+Math.sin(theta)*distanceAlong,angle:theta};
  }
  let d=distance;
  if(this.closed)d=((d%this.total)+this.total)%this.total;
  if(!this.closed&&(d<0||d>this.total)){
   const before=d<0,q=before?this.curves[0]!:this.curves.at(-1)!;
   const t=before?0:1,theta=angle(q,t),point=bezier(q,t);
   const extra=before?d:d-this.total;
   return{x:point.x+Math.cos(theta)*extra,y:point.y+Math.sin(theta)*extra,angle:theta};
  }
  let segment=0;
  while(segment<this.curves.length-1&&this.cumulative[segment+1]!<d)segment++;
  const q=this.curves[segment]!;
  const span=this.cumulative[segment+1]!-this.cumulative[segment]!;
  const fraction=span>EPS?(d-this.cumulative[segment]!)/span:0;
  let t=Math.max(0,Math.min(1,fraction));
  if(this.constantSpeed&&q.total>EPS){
   const wanted=t*q.total;
   let low=0,high=STEPS;
   while(low+1<high){const mid=(low+high)>>1;if(q.table[mid]!<wanted)low=mid;else high=mid;}
   const start=q.table[low]!,end=q.table[high]!;
   t=(low+(end-start>EPS?(wanted-start)/(end-start):0))/STEPS;
  }
  const point=bezier(q,t);
  return{x:point.x,y:point.y,angle:angle(q,t)};
 }
}
