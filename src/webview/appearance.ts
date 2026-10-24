import type {Appearance} from './types';

/** Accent palettes: `text` is the darker variant used where the accent is text on a light theme. */
export const ACCENTS:Record<string,{accent:string;onAccent:string;text:string}>={
 yellow:{accent:'#e5b93c',onAccent:'#1c1a12',text:'#8a6300'},
 amber:{accent:'#d99a1e',onAccent:'#1c1a12',text:'#7d5600'},
 orange:{accent:'#e07b2c',onAccent:'#1c1a12',text:'#8a4410'},
 lime:{accent:'#a8c93a',onAccent:'#16200a',text:'#4d6205'},
 teal:{accent:'#2fb5a0',onAccent:'#08201b',text:'#0a5f52'},
 violet:{accent:'#a98bf0',onAccent:'#1a1330',text:'#5b3fb0'},
 magenta:{accent:'#e06aad',onAccent:'#2a0f1e',text:'#9c2c6d'},
 blue:{accent:'#5b9df0',onAccent:'#08131f',text:'#1c5aa8'}
};

/**
 * Apply `radcode.accent` / font settings to the view root.
 *
 * Settings arrive with every state push, so a change lands without a reload; the CSS declares the
 * same custom properties, which makes this a pure override rather than a second stylesheet.
 */
export function applyAppearance(a:Appearance|undefined):void{
 const root=document.documentElement.style;
 const palette=ACCENTS[a?.accent??'yellow']??ACCENTS.yellow;
 root.setProperty('--accent',palette.accent);
 root.setProperty('--on-accent',palette.onAccent);
 root.setProperty('--highlight',palette.text);
 root.setProperty('--focus',palette.accent);
 if(a?.fontSize)root.setProperty('--ui-size',`${a.fontSize}px`);
 if(a?.lineHeight)root.setProperty('--ui-leading',String(a.lineHeight));
 document.body.classList.toggle('compact',!!a?.compact);
}
