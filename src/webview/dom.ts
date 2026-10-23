/** The one place the view reaches into the document, so a missing element fails loudly and early. */
export const element=<T extends HTMLElement=HTMLElement>(id:string):T=>document.getElementById(id) as T;
