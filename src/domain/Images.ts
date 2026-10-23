/** Images pasted into the composer: validated here, carried as ACP image blocks on the wire. */
export const MAX_IMAGES = 8;
export const MAX_IMAGE_BYTES = 4 * 1024 * 1024;
export const MAX_IMAGE_TOTAL_BYTES = 12 * 1024 * 1024;

/** Only formats every supported provider accepts; SVG and anything else is refused up front. */
export const IMAGE_MIME:Record<string,string>={
 'image/png':'png', 'image/jpeg':'jpg', 'image/webp':'webp', 'image/gif':'gif'
};

export interface ImageAttachment {name:string;mime:string;data:string;size:number;}

/** Size only: base64 inflates by ~4/3, which is why the per-image cap is in decoded bytes. */
export function imageBudgetError(images:{size:number;name:string}[]):string {
 if(images.length>MAX_IMAGES)return `Attach at most ${MAX_IMAGES} images.`;
 const big=images.find(i=>i.size>MAX_IMAGE_BYTES);
 if(big)return `${big.name} is too large (limit ${MAX_IMAGE_BYTES/1024/1024} MB per image).`;
 const total=images.reduce((sum,i)=>sum+i.size,0);
 if(total>MAX_IMAGE_TOTAL_BYTES)return `Images total ${(total/1024/1024).toFixed(1)} MB; the limit is ${MAX_IMAGE_TOTAL_BYTES/1024/1024} MB.`;
 return '';
}

/** Decoded byte length of base64 without allocating the buffer. */
export function base64Bytes(data:string):number {
 const clean=data.replace(/=+$/,'');
 return Math.floor(clean.length*3/4);
}
