import type { ReactNode } from 'react';
import { CompanySettingsContext } from '../context/companySettings';
import { usePublicResource } from '../hooks/usePublicResource';
export default function CompanySettingsProvider({children}:{children:ReactNode}){
 const {data}=usePublicResource<{settings:Record<string,string>}>('settings');
 return <CompanySettingsContext.Provider value={data?.settings||{}}>{children}</CompanySettingsContext.Provider>;
}
