import api,{route} from '@forge/api';
import {buildPortalPlusSnapshot,PORTAL_PLUS_PROPERTY_KEY} from './portal-plus-provider.js';

export async function publishPortalPlusApprovalSnapshot({issueKey='',records=[],updatedAt=new Date().toISOString()}={}){
  const key=String(issueKey||'').trim();
  if(!/^[A-Z][A-Z0-9_]*-\d+$/i.test(key))throw new Error('A valid issue key is required to publish the Portal+ approval snapshot.');
  const snapshot=buildPortalPlusSnapshot(key,records,updatedAt);
  const response=await api.asApp().requestJira(route`/rest/api/3/issue/${key}/properties/${PORTAL_PLUS_PROPERTY_KEY}`,{
    method:'PUT',
    headers:{Accept:'application/json','Content-Type':'application/json'},
    body:JSON.stringify(snapshot)
  });
  if(!response.ok){
    const text=await response.text();
    throw new Error(`Unable to publish Portal+ approval snapshot (${response.status}): ${text}`);
  }
  return{ok:true,issueKey:key,propertyKey:PORTAL_PLUS_PROPERTY_KEY,approvalCount:snapshot.approvals.length,updatedAt:snapshot.updatedAt};
}
