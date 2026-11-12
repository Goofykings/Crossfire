/** PNG alpha extraction for the generated mask textures (8-bit, noninterlaced). */
import {inflateSync} from 'node:zlib';
export function pngAlpha(bytes){
 const width=bytes.readUInt32BE(16),height=bytes.readUInt32BE(20),depth=bytes[24],type=bytes[25],channels={0:1,2:3,3:1,4:2,6:4}[type];
 if(depth!==8||!channels||bytes[28])throw Error('Expected 8-bit noninterlaced PNG');
 const parts=[];let transparency;
 for(let p=8;p<bytes.length;){const n=bytes.readUInt32BE(p),kind=bytes.toString('ascii',p+4,p+8),data=bytes.subarray(p+8,p+8+n);if(kind==='IDAT')parts.push(data);if(kind==='tRNS')transparency=data;p+=12+n;}
 const raw=inflateSync(Buffer.concat(parts)),stride=width*channels,pixels=Buffer.alloc(height*stride),alpha=Buffer.alloc(width*height);
 const paeth=(a,b,c)=>{const p=a+b-c,x=Math.abs(p-a),y=Math.abs(p-b),z=Math.abs(p-c);return x<=y&&x<=z?a:y<=z?b:c;};
 for(let y=0;y<height;y++){const filter=raw[y*(stride+1)],row=y*stride;if(filter>4)throw Error('Unknown PNG filter');for(let x=0;x<stride;x++){const a=x>=channels?pixels[row+x-channels]:0,b=y?pixels[row+x-stride]:0,c=y&&x>=channels?pixels[row+x-stride-channels]:0;pixels[row+x]=(raw[y*(stride+1)+1+x]+(filter===0?0:filter===1?a:filter===2?b:filter===3?Math.floor((a+b)/2):paeth(a,b,c)))&255;}for(let x=0;x<width;x++)alpha[y*width+x]=type===6?pixels[row+x*4+3]:type===4?pixels[row+x*2+1]:type===3?(transparency?.[pixels[row+x]]??255):255;}
 return {width,height,alpha};
}
