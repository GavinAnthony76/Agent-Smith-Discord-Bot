export const demoSession={authenticated:true,runtimeMode:'preview',botOnline:false,botConnected:null,user:{id:'visual-user',username:'Design preview',avatar:null},csrfToken:'',oauthConfigured:false,oauthCallbackRegistered:false,loginUrl:undefined,installUrl:undefined};
export function useGetPlatformSession(){return {data:demoSession,isLoading:false,isError:false,refetch:()=>{}};}
export function getGetPlatformSessionQueryKey(){return ['visual-session'];}
export function useListPlatformGuilds(){return {data:[{id:'visual-demo',name:'Hallowed Core',icon:null,role:'OWNER',policy:'hallowed-core'}]};}
export function useLogoutPlatform(_:unknown){return {mutate:()=>{},isPending:false};}

export function useQueryClient(){return {clear:()=>{}};}
