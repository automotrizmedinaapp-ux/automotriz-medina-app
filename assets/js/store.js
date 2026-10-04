const AM_SIMPLE_STORE = (() => {
  const SELECT_KEY = 'am_admin_selected_reception_v1';
  const requiredPhotos = (window.AM_V4_DATA?.requiredPhotos || ['Frente', 'Frente de tarjeta', 'Reverso de tarjeta']).slice();
  const carouselPhotos = requiredPhotos.filter(name => !/tarjeta/i.test(name));
  const baseInventory = (window.AM_V4_DATA?.baseInventory || ['Herramientas','Llanta de repuesto','Mica','Llave de ruedas','Documentos','Radio/Pantalla']).slice();

  function cryptoToken() { return window.AM_V4_DATA?.token?.() || (Math.random().toString(36).slice(2) + Date.now().toString(36)); }
  function defaults() {
    return {
      config:{schemaVersion:3,businessName:'Automotriz Medina',adminPin:'',employeeToken:'',nextReceptionNumber:1},
      employees:[{id:'edwin',name:'Edwin',token:''},{id:'rafael',name:'Rafael',token:''},{id:'cristian',name:'Cristian',token:''}],
      session:{admin:true,employee:true},selectedId:null,sequence:{reception:0,damage:0,update:0,inventory:0},receptions:[],deletedReceptionNumbers:[],reservedReceptionNumbers:[],employeeNotifications:[]
    };
  }
  function ensureShape(state) {
    const base = defaults();
    state = state && typeof state === 'object' ? state : base;
    if (!Array.isArray(state.receptions)) state.receptions=[];
    state.config={...base.config,...(state.config||{}),schemaVersion:3};
    state.session={...base.session,...(state.session||{})};
    state.sequence={...base.sequence,...(state.sequence||{})};
    if(!Array.isArray(state.employees))state.employees=base.employees;
    if(!Array.isArray(state.deletedReceptionNumbers))state.deletedReceptionNumbers=[];
    if(!Array.isArray(state.reservedReceptionNumbers))state.reservedReceptionNumbers=[];
    if(!Array.isArray(state.employeeNotifications))state.employeeNotifications=[];
    state.receptions=state.receptions.map(rec=>window.AM_V4_DATA?.normalizeReception?.(rec)||rec);
    return state;
  }
  function load() {
    let state=ensureShape(window.AM_V4_DATA?.readAdminState?.()||defaults());
    try{const selected=sessionStorage.getItem(SELECT_KEY);if(selected&&state.receptions.some(r=>r.id===selected))state.selectedId=selected}catch{}
    return state;
  }
  function save(state, options={}) {
    try {
      const ok=window.AM_V4_DATA?.writeAdminState?.(ensureShape(state));
      if(options.markLocalWrite!==false) localStorage.setItem('am_v4_local_write_v1',new Date().toISOString());
      return ok!==false;
    } catch(error) {
      console.warn('No se pudo guardar el estado V4.',error);return false;
    }
  }
  function mutate(callback,options={}){const state=load();const result=callback(state);save(state,options);window.dispatchEvent(new CustomEvent('simple-state-change',{detail:state}));return result}
  function reset(){window.AM_V4_DATA?.resetAll?.();const state=load();window.dispatchEvent(new CustomEvent('simple-state-change',{detail:state}));return state}
  function selected(state=load()){return state.receptions.find(item=>item.id===state.selectedId)||state.receptions[0]}
  function setSelectedId(id){try{if(id)sessionStorage.setItem(SELECT_KEY,id);else sessionStorage.removeItem(SELECT_KEY)}catch{}}
  function next(state,key){
    if(key!=="reception"){state.sequence[key]=Number(state.sequence[key]||0)+1;return state.sequence[key]}
    const blocked=new Set([...(state.deletedReceptionNumbers||[]),...(state.reservedReceptionNumbers||[]),(state.receptions||[]).map(r=>r?.number)].flat().map(v=>String(v||'').trim()).filter(Boolean));
    let candidate=Math.max(Number(state.sequence.reception||0)+1,Number(state.config?.nextReceptionNumber||1));
    while(blocked.has(`AM-R-${String(candidate).padStart(4,'0')}`))candidate+=1;
    state.sequence.reception=candidate;
    if(state.config)state.config.nextReceptionNumber=Math.max(Number(state.config.nextReceptionNumber||1),candidate+1);
    return candidate;
  }
  return{load,save,mutate,reset,selected,setSelectedId,next,requiredPhotos,carouselPhotos,baseInventory,cryptoToken};
})();

// Exponer el store a la capa de sincronización para que pueda actualizar la versión
// confirmada por el servidor después de cada guardado dirigido.
globalThis.AM_SIMPLE_STORE = AM_SIMPLE_STORE;
