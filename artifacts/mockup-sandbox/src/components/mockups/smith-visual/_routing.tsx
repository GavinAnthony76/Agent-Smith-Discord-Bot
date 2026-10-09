import type {AnchorHTMLAttributes} from 'react';
export function Link({href,onClick,...rest}:AnchorHTMLAttributes<HTMLAnchorElement>){return <a {...rest} href={href} onClick={e=>{e.preventDefault();onClick?.(e);}}/>;}
export function useLocation():[string,(path:string)=>void]{return ['/dashboard/visual-demo/overview',()=>{}];}
