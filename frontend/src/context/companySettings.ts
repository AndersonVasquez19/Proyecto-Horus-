import { createContext, useContext } from 'react';
export const CompanySettingsContext=createContext<Record<string,string>>({});
export function useCompanySetting(){const settings=useContext(CompanySettingsContext);return(key:string,fallback:string)=>settings[key]?.trim()||fallback;}
















