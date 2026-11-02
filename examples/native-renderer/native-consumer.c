/* Independently compiled real C consumer. Links riglyph-render-ffi dynamic library.
 * Cross-language contract: opaque handle, caller-owned readback buffer, RGP1 v1.
 */
#include <stdint.h>
#include <stddef.h>
#include <stdio.h>
#include <string.h>
#include <stdlib.h>
#include "riglyph_native.h"

static void u16(uint8_t **p,uint16_t v){for(int i=0;i<2;i++)*(*p)++=(uint8_t)(v>>(i*8));}
static void u32(uint8_t **p,uint32_t v){for(int i=0;i<4;i++)*(*p)++=(uint8_t)(v>>(i*8));}
static void f32(uint8_t **p,float v){uint32_t b;memcpy(&b,&v,4);u32(p,b);}
static void f64(uint8_t **p,double v){uint64_t b;memcpy(&b,&v,8);for(int i=0;i<8;i++)*(*p)++=(uint8_t)(b>>(i*8));}

int main(void){
 if(rg_renderer_abi_version()!=1||rg_renderer_protocol_version()!=1)return 1;
 RiglyphRenderer *renderer=rg_renderer_create(2);
 if(!renderer)return 2;
 const uint8_t tex[4]={240,100,40,255};
 if(rg_renderer_load_texture(renderer,7,1,1,tex,sizeof tex,0,0,0))return 3;
 uint8_t packet[256]={0};uint8_t *p=packet;
 memcpy(p,"RGP1",4);p+=4;u16(&p,1);*p++=2;*p++=0;
 u32(&p,8);u32(&p,8);
 const double v[]={0,0,8,8,0,0,0,0};
 for(int i=0;i<8;i++)f64(&p,v[i]);
 *p++=0;*p++=0;*p++=0;*p++=0;u32(&p,1);
 u32(&p,7);*p++=0;*p++=0;u16(&p,0);
 const double tint[]={1,1,1,1,0,0,0};
 for(int i=0;i<7;i++)f64(&p,tint[i]);
 u32(&p,3);
 const float xyuv[][4]={{1,1,0,0},{7,1,0,0},{1,7,0,0}};
 for(int i=0;i<3;i++)for(int j=0;j<4;j++)f32(&p,xyuv[i][j]);
 if(rg_renderer_render(renderer,packet,(size_t)(p-packet)))return 4;
 uint8_t output[8*8*4]={0};
 if(rg_renderer_get_frame(renderer,output,sizeof output)!=sizeof output)return 5;
 int hits=0;
 for(size_t k=0;k<sizeof output;k+=4)
  if(output[k]==240&&output[k+1]==100&&output[k+2]==40&&output[k+3]==255)hits++;
 if(!hits||output[3]!=0)return 6;
 printf("C consumer: verified %d colored pixels in actual 8x8 render\n",hits);
 rg_renderer_destroy(renderer);
 return 0;
}
