import {createPlayer} from '@riglyph/player-web';
const canvas=document.querySelector('#player');
const player=await createPlayer({canvas,assetUrl:'./assets/scene/manifest.json',enableControls:true});
const defaultAnimation=player.animations()[0]?.id;
player.setSpeed(1);
player.setDefaultMix(0.3); // opt-in crossfade; play() still switches instantly
const unsubscribe=player.on('complete', event=>console.log('completed',event.clipId,event.track));
if(defaultAnimation)player.play(defaultAnimation,{loop:true});
document.querySelector('#play').onclick=()=>defaultAnimation&&player.play(defaultAnimation);
document.querySelector('#pause').onclick=()=>player.pause();
document.querySelector('#fit').onclick=()=>player.setCamera({mode:'fit-scene'});
window.addEventListener('pagehide',()=>{unsubscribe();player.dispose();},{once:true});
