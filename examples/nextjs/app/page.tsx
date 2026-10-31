'use client';
import {useEffect,useRef} from 'react';
import type {WebPlayer} from '@riglyph/player-web';
export default function SkeletonPage(){
 const canvas=useRef<HTMLCanvasElement>(null);
 useEffect(()=>{let disposed=false;let instance:WebPlayer|undefined;
  void import('@riglyph/player-web').then(async ({createPlayer})=>{
   if(!canvas.current||disposed)return;
   const player=await createPlayer({canvas:canvas.current,assetUrl:'/assets/scene/manifest.json'});
   if(disposed){player.dispose();return;}instance=player;player.setSpeed(1);player.setDefaultMix(0.3);
   const clip=player.animations()[0];if(clip)player.play(clip.id);
  }).catch(console.error);
  return()=>{disposed=true;instance?.dispose();};
 },[]);
 return <main><h1>Independent Skeleton Player</h1><canvas ref={canvas} width={800} height={600}/></main>;
}
