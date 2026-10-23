// UI smoke test with isolated HTTP fixtures, using Edge and its DevTools protocol.
const http=require('node:http'),fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),{spawn}=require('node:child_process');
const root=path.resolve(__dirname,'../dist'),browser=process.env.SMOKE_BROWSER||'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const fixtureCourse={id:1,titulo:'Curso de prueba',slug:'curso-de-prueba',tipo:'curso',modalidad:'virtual',duracion:'20 horas',descripcion:'Descripción de prueba',temario:'Temario de prueba',fecha_inicio:'2099-01-01',estado:'publicado'};
const fixtureCap={...fixtureCourse,id:2,titulo:'Capacitación de prueba',slug:'capacitacion-de-prueba',tipo:'capacitacion'};
const fixtureConvenio={id:1,nombre:'Convenio de prueba',sigla:'CDP',logo_url:null,descripcion_corta:'Resumen del convenio de prueba',descripcion_completa:'Descripción completa del convenio de prueba',informacion_adicional:null,orden:1,visible:true,fotos:[]};
const {originalServices,originalCourses,originalGallery}=require('../../backend/dist/content-original/data');
const serviceEntries=originalServices.map((x,i)=>({...x,id:i+1}));
const programEntries=originalCourses.map((x,i)=>({...x,id:i+10}));
const galleryEntries=originalGallery.map((x,i)=>({...x,id:i+10}));
const courseEntries=[fixtureCourse,fixtureCap,...programEntries];
const importBodies=[],serviceBodies=[],courseBodies=[],serviceDeletes=[],courseDeletes=[],adminCourseRequests=[],loginBodies=[],passwordBodies=[];
const service={id:1,titulo:'Servicio de prueba',descripcion:'Descripción del servicio',categoria:'cableado',alcance:'Alcance de prueba',estado:'publicado'};
const quote={id:1,numero:'COT-PRUEBA',cliente:'Cliente de prueba',email:'test@example.com',telefono:'',documento:'',direccion:'',emisor:'Emisor de prueba',datos_emisor:'',moneda:'PEN',validez:'2099-12-31',condiciones:'Condiciones de prueba',conceptos:[{descripcion:'Servicio',cantidad:1,precio:100,importe:100}],subtotal:'100.00',descuento:0,tasa:18,impuesto:'18.00',total:'118.00',estado:'borrador',revision:1,historial:[{accion:'Creada como borrador',usuario:1,fecha:'2026-01-01T00:00:00Z'}]};
let chunkError=false,meUnavailable=false,attention={estado:'nuevo',responsable:'',notas:'',respuesta:'',revision:1,historial:[]},bodies=[],contactBodies=[];
const server=http.createServer(async(req,res)=>{
 try{const u=new URL(req.url,'http://localhost'),p=u.pathname;
 if(p.startsWith('/api/')){
 res.setHeader('Content-Type','application/json');const json=(data,status=200)=>{res.statusCode=status;res.end(JSON.stringify(data))};
 if(p==='/api/contacto'&&req.method==='POST'){let body='';for await(const chunk of req)body+=chunk;contactBodies.push(JSON.parse(body));return json({ok:true,mensaje:'Consulta registrada.',correo_enviado:false})}
 if(p==='/api/settings')return json({ok:true,settings:{}});
 if(p==='/api/admin/login'&&req.method==='POST'){let body='';for await(const chunk of req)body+=chunk;const input=JSON.parse(body);loginBodies.push(input);return input.password==='Clave-correcta-1'?json({ok:true,token:'login-ui-token',mensaje:'Login correcto.',user:{id:1,nombre:'Admin de prueba',email:'admin@example.com'}}):json({message:'Credenciales inválidas.'},401)}
 if(p==='/api/admin/password'&&req.method==='POST'){let body='';for await(const chunk of req)body+=chunk;passwordBodies.push(JSON.parse(body));return json({ok:true,mensaje:'Contraseña actualizada.'})}
 if(p==='/api/admin/stats'){const zero={total:0,publicados:0,borradores:0,archivados:0};return json({ok:true,stats:{mensajes:{total:0,nuevos:0,enProceso:0,atendidos:0},reclamaciones:{total:0},contenido:{total:0},catalogo:{cursos:{...zero,por_tipo:{curso:{...zero,total:1},capacitacion:{...zero,total:2}}},servicios:zero,'preguntas-frecuentes':zero}},actividadReciente:{mensajes:[],reclamaciones:[]}})}
 if(p==='/api/admin/me'){if(meUnavailable)return json({message:'Servicio temporalmente no disponible'},503);return json({ok:true,user:{id:1,nombre:'Admin de prueba',email:'admin@example.com'}})}
 if(p==='/api/admin/cotizaciones')return json({ok:true,items:[quote],pagination:{total:1,pages:1}});
 if(p==='/api/admin/cotizaciones/1')return json({ok:true,item:quote});
 if(p.endsWith('/correo'))return json({message:'No se pudo enviar el correo de prueba.'},503);
 if(p==='/api/admin/messages')return json({ok:true,messages:[{id:1,nombre:'Consulta de prueba',email:'test@example.com',telefono:'',asunto:'Asunto de prueba',mensaje:'Mensaje de prueba',estado:attention.estado,createdAt:'2026-01-01'}],pagination:{total:1,pages:1},metrics:{nuevo:1,en_proceso:0,atendido:0}});
 if(p==='/api/admin/seguimiento/messages/1'){if(req.method==='PUT'){let body='';for await(const chunk of req)body+=chunk;const input=JSON.parse(body);bodies.push(input);attention={...input,revision:input.revision+1,historial:[]};}return json({ok:true,item:attention})}
 if(p==='/api/admin/contenido-original')return json({ok:true,sections:[{key:'servicios',label:'Servicios originales',total:19,titles:originalServices.map(x=>x.titulo)},{key:'capacitaciones',label:'Programas originales',total:4,titles:originalCourses.map(x=>x.titulo)},{key:'galeria',label:'Galería original',total:61,titles:originalGallery.map(x=>x.titulo)}]});
 if(p.startsWith('/api/admin/contenido-original/')&&req.method==='POST'){let body='';for await(const chunk of req)body+=chunk;importBodies.push(JSON.parse(body));return json({ok:true,created:0,existing:19,mensaje:'0 registros recuperados. Los existentes se conservaron.'})}
 if(p==='/api/admin/servicios'&&req.method==='POST'){let body='';for await(const chunk of req)body+=chunk;const sent=JSON.parse(body);serviceBodies.push({method:'POST',body:sent});const item={...sent,id:Math.max(...serviceEntries.map(x=>x.id))+1};serviceEntries.push(item);return json({ok:true,item})}
 if(p==='/api/admin/cursos'&&req.method==='POST'){let body='';for await(const chunk of req)body+=chunk;const sent=JSON.parse(body);courseBodies.push({method:'POST',body:sent});const item={...sent,id:Math.max(...courseEntries.map(x=>x.id))+1};courseEntries.push(item);return json({ok:true,item})}
 if(/^\/api\/admin\/cursos\/\d+$/.test(p)&&req.method==='PUT'){const entry=courseEntries.find(x=>x.id===Number(p.split('/').pop()));if(!entry)return json({ok:false,mensaje:'Contenido no encontrado.'},404);let body='';for await(const chunk of req)body+=chunk;const sent=JSON.parse(body);courseBodies.push({method:'PUT',id:entry.id,body:sent});const {limpiar,...rest}=sent;Object.assign(entry,rest);for(const key of limpiar||[])entry[key]=null;return json({ok:true,item:entry})}
 if(/^\/api\/admin\/cursos\/\d+$/.test(p)&&req.method==='GET'){const entry=courseEntries.find(x=>x.id===Number(p.split('/').pop()));return entry?json({ok:true,item:entry}):json({ok:false,mensaje:'Contenido no encontrado.'},404)}
 if(/^\/api\/admin\/cursos\/\d+$/.test(p)&&req.method==='DELETE'){const id=Number(p.split('/').pop());courseDeletes.push(id);if(!courseEntries.some(x=>x.id===id))return json({ok:false,mensaje:'Contenido no encontrado.'},404);return json({ok:false,mensaje:'Los cursos y capacitaciones se conservan. Archiva desde Editar.'},409)}
 if(/^\/api\/admin\/servicios\/\d+$/.test(p)&&req.method==='DELETE'){const id=Number(p.split('/').pop()),index=serviceEntries.findIndex(x=>x.id===id);if(index<0)return json({ok:false,mensaje:'Contenido no encontrado.'},404);serviceEntries.splice(index,1);serviceDeletes.push(id);return json({ok:true,mensaje:'Servicio eliminado definitivamente.'})}
 if(/^\/api\/admin\/servicios\/\d+$/.test(p)&&req.method!=='DELETE'){const entry=serviceEntries.find(x=>x.id===Number(p.split('/').pop()));if(!entry)return json({ok:false,mensaje:'Contenido no encontrado.'},404);if(req.method==='PUT'){let body='';for await(const chunk of req)body+=chunk;const sent=JSON.parse(body);serviceBodies.push({method:'PUT',id:entry.id,body:sent});const {limpiar,...rest}=sent;Object.assign(entry,rest);for(const key of limpiar||[])entry[key]=null}return json({ok:true,item:entry})}
 if(p==='/api/cursos/1')return json({ok:true,item:fixtureCourse});
 if(p==='/api/servicios/1')return json({ok:true,item:service});
 if(/^\/api\/(cursos|servicios)\/\d+$/.test(p)&&req.method==='GET')return json({statusCode:404,message:'Cannot GET '+p,error:'Not Found'},404);
 if(p==='/api/convenios/1')return json({ok:true,item:fixtureConvenio});
 if(p==='/api/convenios')return json({ok:true,items:[fixtureConvenio],pagination:{page:1,limit:6,total:1,pages:1}});
 if(p==='/api/admin/cursos')adminCourseRequests.push(u.search);let items=['/api/cursos','/api/admin/cursos'].includes(p)?courseEntries.filter(x=>(!u.searchParams.get('tipo')||x.tipo===u.searchParams.get('tipo'))&&(!u.searchParams.get('modalidad')||x.modalidad===u.searchParams.get('modalidad'))):['/api/servicios','/api/admin/servicios'].includes(p)?serviceEntries.filter(x=>!u.searchParams.get('categoria')||u.searchParams.get('categoria').split(',').includes(x.categoria)):p==='/api/preguntas-frecuentes'?[{id:1,pregunta:'Pregunta de prueba',respuesta:'Respuesta de prueba',categoria:'General'}]:p==='/api/galeria'?galleryEntries.filter(x=>!u.searchParams.get('categoria')||x.categoria===u.searchParams.get('categoria')):[];
 const total=items.length,page=Number(u.searchParams.get('page')||1),limit=Number(u.searchParams.get('limit')||24);items=items.slice((page-1)*limit,page*limit);
 return json({ok:true,items,categorias:[...new Set(galleryEntries.map(x=>x.categoria))],pagination:{total,pages:Math.ceil(total/limit)}});
 }
 if(chunkError&&p.startsWith('/assets/AdminDashboard-')&&p.endsWith('.js')){res.statusCode=503;return res.end('Isolated chunk failure')}
 let filename=path.resolve(root,'.'+decodeURIComponent(p));
 if(!filename.startsWith(root+path.sep))filename=path.join(root,'index.html');
 if(!fs.existsSync(filename)||fs.statSync(filename).isDirectory())filename=path.join(root,'index.html');
 const ext=path.extname(filename);res.setHeader('Content-Type',({'.html':'text/html','.js':'text/javascript','.css':'text/css','.png':'image/png','.jpg':'image/jpeg','.jpeg':'image/jpeg','.webp':'image/webp'})[ext]||'application/octet-stream');res.end(fs.readFileSync(filename));
 }catch{res.statusCode=500;res.end('Fixture failure')}
});
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
// Peticiones a otros orígenes: se rechazan ANTES de salir a Internet (como en el resto de smokes). Las pantallas piden fuentes, iconos y un mapa embebido que
// ninguna aserción necesita. Si salían, un origen lento dejaba la página sin montar (las hojas de estilo bloquean los scripts) y la espera de carga fallaba.
const externalBlocked=[];
function interceptExternal(msg,origin,send){
 if(msg.method!=='Fetch.requestPaused')return false;
 const {requestId,request}=msg.params;let local=false;
 try{const x=new URL(request.url);local=x.origin===origin||x.protocol==='data:'||x.protocol==='blob:'}catch{local=false}
 if(local)send('Fetch.continueRequest',{requestId}).catch(()=>{});
 else{externalBlocked.push({method:request.method,url:request.url.slice(0,100)});send('Fetch.failRequest',{requestId,errorReason:'BlockedByClient'}).catch(()=>{})}
 return true;
}
async function main(){
 if(!fs.existsSync(browser))throw new Error('Configura SMOKE_BROWSER con una instalación de Edge/Chromium.');
 await new Promise(r=>server.listen(0,'127.0.0.1',r));const origin='http://127.0.0.1:'+server.address().port;
 const reserve=http.createServer();await new Promise(r=>reserve.listen(0,'127.0.0.1',r));const port=reserve.address().port;await new Promise(r=>reserve.close(r));
 const profile=require('./smoke-cleanup.cjs').createProfile('horus-ui-');let socket,child,cleanup;const pending=new Map();let seq=0;
 try{
 child=spawn(browser,['--headless=new','--disable-gpu','--no-first-run','--no-default-browser-check','--remote-debugging-port='+port,'--user-data-dir='+profile,'about:blank'],{detached:process.platform!=='win32',windowsHide:true,stdio:'ignore'});
 cleanup=require('./smoke-cleanup.cjs')(child,profile,server);
 let target;for(let i=0;i<100&&!target;i++){await sleep(100);try{target=await fetch('http://127.0.0.1:'+port+'/json/new?about:blank',{method:'PUT'}).then(r=>r.json())}catch{}}
 if(!target?.webSocketDebuggerUrl)throw new Error('No se pudo iniciar Edge para la revisión.');
 socket=new WebSocket(target.webSocketDebuggerUrl);await new Promise((r,j)=>{socket.onopen=r;socket.onerror=j});
 socket.onmessage=event=>{const msg=JSON.parse(event.data);if(interceptExternal(msg,origin,send))return;if(msg.id){const p=pending.get(msg.id);pending.delete(msg.id);if(msg.error)p?.reject(new Error(msg.error.message));else p?.resolve(msg.result)}};
 const send=(method,params={})=>new Promise((resolve,reject)=>{const id=++seq;pending.set(id,{resolve,reject});socket.send(JSON.stringify({id,method,params}))});
 const evaluate=async expression=>{const r=await send('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});if(r.exceptionDetails)throw new Error(r.exceptionDetails.exception?.description||r.exceptionDetails.text);return r.result.value};
 const wait=async expression=>{for(let i=0;i<100;i++){if(await evaluate(expression))return;await sleep(100)}throw new Error('No se cumplió: '+expression)};
 const navigate=async route=>{await send('Page.navigate',{url:origin+route});await wait('document.readyState==="complete"');await sleep(300)};
 const click=label=>evaluate('Array.from(document.querySelectorAll("button,a")).find(x=>x.textContent.trim()==='+JSON.stringify(label)+')?.click()');
 await send('Page.enable');await send('Runtime.enable');await send('Fetch.enable',{patterns:[{urlPattern:'*'}]});
 await send('Emulation.setDeviceMetricsOverride',{width:1440,height:1000,deviceScaleFactor:1,mobile:false});
 await navigate('/educacion/cursos');await wait('!!document.querySelector(".edu-empty")');
 assert.equal(await evaluate('document.querySelector("h1").textContent'),'Cursos');assert.equal(await evaluate('document.querySelector(".horus-hero-eyebrow").textContent'),'Educación');
 assert.equal(await evaluate('document.body.innerText.includes("Actualizar catálogo")'),false,'El botón de desarrollo ya no existe.');
 assert.equal(await evaluate('document.querySelector("[role=alert]")===null'),true,'Sin cursos publicados: estado vacío, no error.');
 // Contenido institucional en código (src/institutional/catalog.ts): las capacitaciones reales sustituyen al curso simulado.
 await navigate('/educacion/capacitaciones');await wait('document.querySelectorAll("article.edu-card").length===4');
 const capCard='[...document.querySelectorAll("article.edu-card")].find(a=>a.textContent.includes("Capacitaciones Empresariales"))';
 assert.equal(await evaluate('document.querySelector("h1").textContent'),'Capacitaciones');
 assert.equal(await evaluate(capCard+'.querySelector("a[aria-label^=Consultar]").getAttribute("aria-label")'),'Consultar sobre Capacitaciones Empresariales');
 await evaluate(capCard+'.querySelector("a[aria-label^=Consultar]").click()');await wait('location.pathname==="/contactos"');assert.equal(await evaluate('document.getElementById("ct-asunto").value'),'Consulta sobre: Capacitaciones Empresariales','Consultar conserva el nombre de la capacitación como asunto.');
 await navigate('/educacion/capacitaciones/7');await wait('document.querySelector("h1")?.textContent==="Capacitaciones Empresariales"');
 await click('Solicitar información');await wait('document.getElementById("ct-asunto")?.value==="Consulta sobre: Capacitaciones Empresariales"');
 await evaluate(`(()=>{const values={nombre:'Ana de prueba',email:'test@example.com',telefono:'+51 999 888 777',mensaje:'Consulta de prueba'};for(const [name,value] of Object.entries(values)){const el=document.getElementById('ct-'+name);Object.getOwnPropertyDescriptor(el.tagName==='TEXTAREA'?HTMLTextAreaElement.prototype:HTMLInputElement.prototype,'value').set.call(el,value);el.dispatchEvent(new Event('input',{bubbles:true}));}})()`);await sleep(100);await evaluate('document.getElementById("ct-nombre").form.requestSubmit()');await wait('document.body.innerText.includes("Recibimos tu mensaje. Gracias por escribirnos. No es necesario que lo envíes de nuevo.")');assert.equal(contactBodies.length,1);assert.equal(contactBodies[0].telefono,'+51 999 888 777');assert.equal(contactBodies[0].asunto,'Consulta sobre: Capacitaciones Empresariales');
 await navigate('/preguntas-frecuentes');await wait('document.querySelector("h1")?.textContent.includes("Preguntas")');assert.equal(await evaluate('document.querySelector("[role=alert]")===null'),true,'FAQ vacía: sin error.');
 console.log('UI: catálogo, consultas y FAQ comprobados.');
 await navigate('/galeria');await wait('!!document.querySelector(".gl-card")');await evaluate('document.querySelector(".gl-card").focus();document.querySelector(".gl-card").click()');await wait('!!document.querySelector("dialog[open]")');await send('Input.dispatchKeyEvent',{type:'keyDown',key:'Escape',code:'Escape',windowsVirtualKeyCode:27,nativeVirtualKeyCode:27});await wait('!document.querySelector("dialog[open]")');assert.equal(await evaluate('document.activeElement.classList.contains("gl-card")'),true);
 await navigate('/');await wait('!!document.querySelector("[data-agreement-toggle]")');await evaluate('document.querySelector("[data-agreement-toggle]").click()');await wait('document.querySelector("[data-agreement-toggle]").getAttribute("aria-expanded")==="true"');await evaluate('document.querySelector("[data-agreement-detail]").click()');await wait('!!document.querySelector("#convModal #convDesc")');assert.equal(await evaluate('document.querySelector("#convNombre").textContent'),'Colegio Regional de Licenciados en Administración de Cajamarca');await evaluate('document.querySelector("#convClose").click()');await wait('!document.querySelector("#convModal #convDesc")');
 await send('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:true});await navigate('/educacion/cursos');await wait('!!document.querySelector(".nav-toggle")');await evaluate('document.querySelector(".nav-toggle").click()');await wait('document.querySelector(".nav-toggle").getAttribute("aria-expanded")==="true"');await send('Input.dispatchKeyEvent',{type:'keyDown',key:'Escape',code:'Escape',windowsVirtualKeyCode:27,nativeVirtualKeyCode:27});await wait('document.querySelector(".nav-toggle").getAttribute("aria-expanded")==="false"');
 assert.equal(await evaluate('document.documentElement.scrollWidth<=innerWidth+1'),true);
 console.log('UI: diálogos, foco y menú móvil comprobados.');
 await send('Emulation.setDeviceMetricsOverride',{width:1440,height:1000,deviceScaleFactor:1,mobile:false});
 // Navbar de escritorio: landmark, grupo activo, hover coherente con aria-expanded, clic fuera; y la 404 con el diseño del sitio.
 await navigate('/educacion/cursos');await wait('!!document.querySelector(".nav-drop > button")');
 assert.equal(await evaluate('document.querySelectorAll("nav[aria-label=\'Navegación principal\']").length'),1,'El menú principal es un landmark nav.');
 assert.equal(await evaluate('(()=>{const [t,e]=document.querySelectorAll(".nav-drop > button");return [t.classList.contains("active"),e.classList.contains("active"),e.getAttribute("aria-current")].join()})()'),'false,true,true','Educación figura como grupo activo en /educacion/cursos.');
 assert.equal(await evaluate('[...document.querySelectorAll(".nav-links a[aria-current=page]")].map(a=>a.textContent.trim()).join()'),'Cursos','Solo la página actual (Cursos, dentro de Educación) se marca con aria-current=page.');
 await evaluate('document.querySelector(".nav-drop").dispatchEvent(new PointerEvent("pointerover",{bubbles:true,pointerType:"mouse"}))');
 await wait('document.querySelector(".nav-drop > button").getAttribute("aria-expanded")==="true"');
 assert.equal(await evaluate('getComputedStyle(document.querySelector(".nav-drop .dropdown")).visibility'),'visible','El hover abre el menú y aria-expanded lo refleja.');
 await evaluate('document.querySelector(".nav-drop").dispatchEvent(new PointerEvent("pointerout",{bubbles:true,pointerType:"mouse",relatedTarget:document.body}))');
 await wait('document.querySelector(".nav-drop > button").getAttribute("aria-expanded")==="false"');
 await wait('getComputedStyle(document.querySelector(".nav-drop .dropdown")).visibility==="hidden"'); // el fade de salida dura 200 ms
 console.log('UI: al salir el ratón el menú y aria-expanded se cierran juntos.');
 await evaluate('document.querySelector(".nav-drop > button").click()');await wait('document.querySelector(".nav-drop > button").getAttribute("aria-expanded")==="true"');
 await evaluate('document.querySelector("main").dispatchEvent(new PointerEvent("pointerdown",{bubbles:true,pointerType:"mouse"}))');
 await wait('document.querySelector(".nav-drop > button").getAttribute("aria-expanded")==="false"');
 await navigate('/ruta-inexistente-de-prueba');await wait('!!document.querySelector(".nf-page h1")');
 assert.deepEqual(JSON.parse(await evaluate('JSON.stringify({main:document.querySelectorAll("main").length,h1:[...document.querySelectorAll("h1")].map(h=>h.textContent),nav:!!document.querySelector("header.nav"),footer:!!document.querySelector("footer.footer"),title:document.title.startsWith("Página no encontrada — "),robots:document.querySelector("meta[name=robots]")?.content,inicio:document.querySelector(".nf-page a[href=\\"/\\"]")?.textContent.trim(),contacto:!!document.querySelector(".nf-page a[href=\\"/contactos\\"]"),legacy:!!document.querySelector(".btn-coral"),inline:document.querySelectorAll(".nf-page [style]").length,overflow:document.documentElement.scrollWidth-innerWidth<=0})')),{main:1,h1:['Página no encontrada'],nav:true,footer:true,title:true,robots:'noindex',inicio:'Volver al inicio',contacto:true,legacy:false,inline:0,overflow:true},'La 404 usa el layout del sitio, un solo main y un solo h1.');
 await evaluate('document.querySelector(".nf-page a[href=\\"/\\"]").click()');await wait('location.pathname==="/"&&!!document.querySelector(".home-hero")');
 assert.equal(await evaluate('!document.querySelector("meta[name=robots]")'),true,'El noindex de la 404 se retira al salir.');
 await evaluate('history.back()');await wait('location.pathname==="/ruta-inexistente-de-prueba"&&!!document.querySelector(".nf-page h1")');
 console.log('UI: Navbar de escritorio (landmark, grupo activo, hover/aria-expanded, clic fuera) y página 404: OK.');
 // Detalles inexistentes: estado específico (no un 404 genérico ni un error de conexión), con regreso a una ruta pública válida.
 for(const [route,heading,label,href] of [['/educacion/cursos/99999','Curso no disponible','Volver a cursos','/educacion/cursos'],['/educacion/capacitaciones/99999','Capacitación no disponible','Volver a capacitaciones','/educacion/capacitaciones'],['/tecnologias/servicios/99999','Servicio no disponible','Ver servicios de tecnología','/tecnologias/cableado-estructurado']]){
  await navigate(route);await wait('[...document.querySelectorAll("h1")].some(h=>h.textContent===""+'+JSON.stringify(heading)+')');
  assert.deepEqual(JSON.parse(await evaluate('JSON.stringify({main:document.querySelectorAll("main").length,h1:document.querySelectorAll("h1").length,title:document.title,mensaje:document.querySelector(".tech-state p")?.textContent,estado:document.querySelector(".tech-state")?.getAttribute("role"),reintentar:[...document.querySelectorAll(".tech-state button")].length,volver:[...document.querySelectorAll(".tech-state a")].map(a=>a.textContent.trim()+"|"+a.getAttribute("href")),nav:!!document.querySelector("header.nav"),footer:!!document.querySelector("footer.footer")})')),{main:1,h1:1,title:heading+' — Horus Group SRL',mensaje:'El contenido que buscas no está disponible.',estado:'status',reintentar:0,volver:[label+'|'+href],nav:true,footer:true},route+' muestra "'+heading+'".');
 }
 console.log('UI: detalles de curso, capacitación y servicio inexistentes (h1, título, mensaje y regreso): OK.');
 // Login: a wrong password is a red error; a correct one shows no message at all and opens the panel.
 await navigate('/admin/login');await wait('!!document.getElementById("email")');
 const typeLogin=(id,value)=>evaluate('(()=>{const el=document.getElementById('+JSON.stringify(id)+');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,"value").set.call(el,'+JSON.stringify(value)+');el.dispatchEvent(new Event("input",{bubbles:true}))})()');
 await typeLogin('email','admin@example.com');await typeLogin('password','incorrecta');await sleep(100);await evaluate('document.querySelector(".admin-auth__form").requestSubmit()');
 await wait('!!document.querySelector(".admin-auth__error")');
 assert.equal(await evaluate('document.querySelector(".admin-auth__error").textContent'),'Revisa tu correo y contraseña e inténtalo nuevamente.'); // Mensaje genérico propio: el texto del servidor no se muestra.
 assert.equal(await evaluate('getComputedStyle(document.querySelector(".admin-auth__error")).color'),'rgb(151, 43, 37)','El error se muestra en rojo.');
 await wait('document.querySelector(".admin-auth__submit").disabled===false');
 await typeLogin('password','Clave-correcta-1');
 await evaluate('window.__loginMessages=[];const before=new WeakSet(document.querySelectorAll(".admin-auth__error,[data-sonner-toast]"));new MutationObserver(()=>{document.querySelectorAll(".admin-auth__error,[data-sonner-toast]").forEach(e=>{if(!before.has(e))window.__loginMessages.push(e.textContent)})}).observe(document.body,{childList:true,subtree:true})');
 await sleep(100);await evaluate('document.querySelector(".admin-auth__form").requestSubmit()');
 await wait('location.pathname==="/admin/dashboard"&&!!document.querySelector(".hp-shell")');
 assert.deepEqual(await evaluate('window.__loginMessages'),[],'Un login correcto no muestra ningún mensaje.');
 assert.equal(await evaluate('localStorage.getItem("horus-admin-token")'),'login-ui-token');assert.equal(loginBodies.length,2);
 await evaluate('localStorage.setItem("horus-admin-token","isolated-ui-test-token")');

 const capture=async(name,selector)=>{if(!process.env.SMOKE_SCREENSHOTS)return;await evaluate('document.querySelector('+JSON.stringify(selector)+')?.scrollIntoView({block:"start"})');await sleep(300);const result=await send('Page.captureScreenshot',{format:'png'});fs.mkdirSync(process.env.SMOKE_SCREENSHOTS,{recursive:true});fs.writeFileSync(path.join(process.env.SMOKE_SCREENSHOTS,name+'.png'),Buffer.from(result.data,'base64'));};
 await navigate('/tecnologias/cableado-estructurado');await wait('document.querySelectorAll("#categorias article").length===6');
 assert.equal(await evaluate('!!document.querySelector("#soluciones,.cable-panel,[role=tablist]")'),false,'Cableado conserva las seis categorías sin la sección de soluciones retirada.');
 await wait('document.querySelector("#categorias article img")?.naturalWidth>0');await capture('cableado-desktop','#categorias');
 await navigate('/tecnologias/camaras-seguridad');await wait('document.querySelectorAll(".cam-card").length===7');assert.equal(await evaluate('document.querySelectorAll(".cam-card-media").length'),7);await capture('camaras-desktop','#soluciones');
 await navigate('/tecnologias/soporte-mantenimiento');await wait('document.querySelectorAll(".sop-card").length===3');
 await wait('Array.from(document.querySelectorAll(".sop-card-media img")).slice(0,2).every(i=>i.complete&&i.naturalWidth>0)');
 assert.deepEqual(await evaluate('Array.from(document.querySelectorAll(".sop-card-media img"),i=>new URL(i.src).pathname).slice(0,2)'),['/contenido/702b9c58-7d36-4af4-9b08-6086ee0e4c3a.jpg','/contenido/7d24640f-ea42-4625-a228-5dce8e973fa6.jpg'],'Soporte muestra la imagen del registro aunque su presentación sea mantenimiento o software.');
 assert.equal(await evaluate('!!document.querySelector(".sop-terminal,.sop-maint-cycle,.sop-card-visual")'),false,'No quedan ilustraciones fijas en Soporte.');await capture('soporte-desktop','#servicios');
 await navigate('/educacion/asesoramiento');await wait('document.querySelectorAll(".edu-card").length===3');assert.equal(await evaluate('document.querySelectorAll(".edu-benefit").length'),0,'Sin servicios de tipo beneficio publicados: la sección no se muestra.');assert.equal(await evaluate('document.querySelector("h1").textContent'),'Asesoramiento');await capture('asesoramiento-desktop','#asesoramiento');
 await navigate('/educacion/capacitaciones');await wait('document.querySelectorAll(".edu-card").length===4');assert.equal(await evaluate('Array.from(document.querySelectorAll(".edu-card h3")).some(h=>h.textContent.includes("Capacitaciones Empresariales"))'),true);assert.equal(await evaluate('document.querySelector("h1").textContent'),'Capacitaciones');await capture('capacitaciones-desktop','#catalogo');
 await navigate('/galeria');await wait('document.querySelectorAll(".gl-band-panel img").length>=1');await wait('document.querySelector(".gl-band-panel img")?.naturalWidth>0');await capture('galeria-carrusel','.gl-intro');
 await evaluate('Array.from(document.querySelectorAll(".gl-chip")).find(x=>x.textContent.trim()==="Capacitaciones").click()');await wait('document.querySelector(".gl-chip[aria-pressed=true]")?.textContent==="Capacitaciones"&&document.querySelector(".gl-grid")?.getAttribute("aria-busy")!=="true"');assert.equal(await evaluate('Array.from(document.querySelectorAll(".gl-card-cat")).every(x=>x.textContent==="Capacitaciones")'),true);await capture('galeria-desktop','#galeria');
 await send('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:true});
 for(const [route,selector] of [['/tecnologias/cableado-estructurado','#categorias'],['/tecnologias/camaras-seguridad','#soluciones'],['/tecnologias/soporte-mantenimiento','#servicios'],['/educacion/asesoramiento','#asesoramiento'],['/educacion/capacitaciones','#catalogo'],['/galeria','#galeria']]){
  await navigate(route);await wait('!document.querySelector("[role=status]")?.textContent.includes("Cargando")');await sleep(200);assert.equal(await evaluate('document.documentElement.scrollWidth<=innerWidth+1'),true,'Desbordamiento móvil: '+route);await capture(route.split('/').at(-1)+'-mobile',selector);
 }
 await send('Emulation.setDeviceMetricsOverride',{width:1440,height:1000,deviceScaleFactor:1,mobile:false});
 await evaluate('localStorage.setItem("horus-admin-token","isolated-ui-test-token")');
 await navigate('/tecnologias/cableado-estructurado');await wait('document.querySelectorAll("#categorias article").length===6');
 // A second real tab saves the panel form. The open public tab receives the browser storage event.
 const adminTarget=await fetch('http://127.0.0.1:'+port+'/json/new?about:blank',{method:'PUT'}).then(r=>r.json());
 const adminSocket=new WebSocket(adminTarget.webSocketDebuggerUrl);await new Promise((r,j)=>{adminSocket.onopen=r;adminSocket.onerror=j});
 let adminSeq=0;const adminPending=new Map();adminSocket.onmessage=e=>{const m=JSON.parse(e.data);if(interceptExternal(m,origin,adminSend))return;if(m.id){const pending=adminPending.get(m.id);adminPending.delete(m.id);m.error?pending?.reject(new Error(m.error.message)):pending?.resolve(m.result)}};
 const adminSend=(method,params={})=>new Promise((resolve,reject)=>{const id=++adminSeq;adminPending.set(id,{resolve,reject});adminSocket.send(JSON.stringify({id,method,params}))});
 const adminEval=async expression=>{const result=await adminSend('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});if(result.exceptionDetails)throw new Error((result.exceptionDetails.exception?.description||result.exceptionDetails.text)+' :: '+expression.slice(0,240));return result.result.value};
 const adminWait=async expression=>{for(let i=0;i<100;i++){if(await adminEval(expression))return;await sleep(100)}const detail=await adminEval('document.querySelector(".hp-error")?.textContent||""').catch(()=>'');throw new Error('Panel: '+expression+(detail?' :: '+detail:''))};
 await adminSend('Page.enable');await adminSend('Fetch.enable',{patterns:[{urlPattern:'*'}]});await adminSend('Page.navigate',{url:origin+'/admin/dashboard?section=servicios'});
 try{
  for(const section of ['educacion','cursos','servicios','galeria','faq','contenido','convenios','ajustes']){
   await adminSend('Page.navigate',{url:origin+'/admin/dashboard?section='+section+'&crear=1'});
   await adminWait('!!document.querySelector("[data-panel-editorial-retired]")');
   assert.equal(await adminEval('!!document.querySelector("main form,dialog[open]")'),false,'Gestor retirado: '+section);
  }
  assert.equal(serviceBodies.length,0,'Las rutas retiradas no escriben servicios.');
  assert.equal(courseBodies.length,0,'Las rutas retiradas no escriben cursos.');
  assert.equal(importBodies.length,0,'Las rutas retiradas no restauran contenido.');
  await adminSend('Page.navigate',{url:origin+'/admin/dashboard?section=resumen'});
  await adminWait('!!document.querySelector(".hp-sidebar")');
  const sidebarText=await adminEval('document.querySelector("#panel-sidebar").textContent');
  assert.ok(!/Educación|Galería de proyectos|Convenios|Biblioteca de contenido|Información de empresa/.test(sidebarText));
  await adminEval('Array.from(document.querySelectorAll("aside nav button")).find(x=>x.textContent.includes("Mi cuenta")).click()');
  await adminWait('location.search.includes("section=configuracion")&&document.querySelector("h1").textContent==="Mi cuenta"');
  assert.equal(await adminEval('Array.from(document.querySelectorAll("aside nav button")).find(x=>x.textContent.includes("Mi cuenta")).getAttribute("aria-current")'),'page');
  assert.equal(await adminEval('document.querySelector(".hp-heading p:not(.hp-kicker)").textContent'),'Gestiona el acceso de tu propia cuenta.');
  assert.equal(await adminEval('document.querySelectorAll(".hp-password-card input[type=password]").length'),3);
  await adminEval('window.__fill=(values)=>{const inputs=document.querySelectorAll(".hp-password-card input");values.forEach((value,i)=>{Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,"value").set.call(inputs[i],value);inputs[i].dispatchEvent(new Event("input",{bubbles:true}))})}');
  await adminEval('window.__fill(["Clave-correcta-1","Nueva-clave-segura-1","Otra-clave-distinta-1"])');await sleep(100);
  await adminEval('document.querySelector(".hp-password-card form").requestSubmit()');
  await adminWait('document.querySelector(".hp-password-card [role=alert]")?.textContent==="Las contraseñas no coinciden."');
  assert.equal(passwordBodies.length,0,'Con contraseñas distintas no se envía nada.');
  await adminEval('window.__fill(["Clave-correcta-1","Nueva-clave-segura-1","Nueva-clave-segura-1"])');await sleep(100);
  await adminEval('document.querySelector(".hp-password-card form").requestSubmit()');
  await adminWait('location.pathname==="/admin/login"');
  assert.deepEqual(passwordBodies,[{current_password:'Clave-correcta-1',password:'Nueva-clave-segura-1'}]);
  assert.equal(await adminEval('localStorage.getItem("horus-admin-token")'),null,'Cambiar la contraseña cierra la sesión.');
  await evaluate('localStorage.setItem("horus-admin-token","isolated-ui-test-token")');
 }finally{await adminSend('Page.close').catch(()=>{});adminSocket.close()}
 console.log('UI: páginas públicas, teclado, carrusel, filtros, móvil, rutas editoriales retiradas y cuenta personal: OK.');

 await navigate('/admin/dashboard?section=cotizaciones');await wait('Array.from(document.querySelectorAll("button")).some(x=>x.textContent.trim()==="Ver propuesta"&&!x.disabled)');await click('Ver propuesta');await wait('!!document.querySelector(".hq-document")');assert.ok(await evaluate('document.querySelector(".hq-document").textContent.includes("118.00")'));await click('Enviar por correo');await wait('document.body.innerText.includes("No se pudo enviar el correo de prueba.")');await evaluate('document.querySelector("dialog header button").click()');
 await navigate('/admin/messages');await wait('document.body.innerText.includes("Consulta de prueba")');await evaluate('document.querySelector(".hw-inbox-list button").click()');await wait('document.body.innerText.includes("Seguimiento de atención")');await wait('document.querySelector(".hw-inbox-detail textarea")!==null');
 await click('Guardar seguimiento');await wait('document.body.innerText.includes("Seguimiento guardado.")');await wait('Array.from(document.querySelectorAll("button")).some(x=>x.textContent.trim()==="Guardar seguimiento"&&!x.disabled)');await click('Guardar seguimiento');await wait(''+JSON.stringify(true));await sleep(500);assert.equal(bodies.length,2);assert.deepEqual(Object.keys(bodies[1]).sort(),['estado','notas','responsable','respuesta','revision']);
 meUnavailable=true;await navigate('/admin/dashboard?section=cotizaciones');await wait('document.body.innerText.includes("No pudimos validar tu sesión")');assert.ok(await evaluate('localStorage.getItem("horus-admin-token")'));meUnavailable=false;assert.equal(await evaluate('!!document.querySelector(".hp-shell")'),false);await click('Reintentar');await wait('document.body.innerText.includes("Cotizaciones")');
 await send('Network.enable');await send('Network.setCacheDisabled',{cacheDisabled:true});chunkError=true;await navigate('/admin/dashboard?section=cotizaciones');await wait('document.body.innerText.includes("No pudimos abrir esta página")');chunkError=false;await click('Recargar página');await wait('document.body.innerText.includes("Cotizaciones")');
 console.log('UI: carga de pantallas y recuperación de error comprobados.');
 console.log('UI: catálogo, detalle, consulta, FAQ vacía, galería/foco, convenio, menú móvil, cotización, error de correo, seguimiento y sesión transitoria: OK.');
 // Mapa de ubicación (Inicio y Contactos, escritorio y móvil): tarjeta con la dirección, sin iframe ni peticiones externas hasta pulsar «Mostrar mapa».
 const mapButton='Mostrar mapa — requiere Internet';
 const cardState='JSON.stringify({card:!!document.querySelector(".location-map-fallback"),address:(document.querySelector(".location-map-fallback-address")||{}).textContent||"",iframes:document.querySelectorAll("iframe").length,button:!!Array.from(document.querySelectorAll("button")).find(x=>x.textContent.trim()==='+JSON.stringify(mapButton)+')})';
 const fitsViewport='document.documentElement.scrollWidth<=innerWidth';
 for(const [route,box] of [['/','.home-location-map'],['/contactos','.ct-map']]){
  for(const [w,h,mobile] of [[1440,1000,false],[390,844,true]]){
   await send('Emulation.setDeviceMetricsOverride',{width:w,height:h,deviceScaleFactor:1,mobile});
   const before=externalBlocked.length;
   await navigate(route);await wait('!!document.querySelector("'+box+' .location-map-fallback")');await sleep(500);
   const card=JSON.parse(await evaluate(cardState));
   assert.equal(card.card,true,route+' '+w+': la tarjeta de ubicación aparece al cargar.');assert.ok(card.address.length>0,route+': la tarjeta muestra la dirección.');assert.equal(card.iframes,0,route+' '+w+': no hay iframe antes de pulsar.');assert.equal(card.button,true);
   assert.equal(externalBlocked.length,before,route+' '+w+': ninguna petición externa antes de pulsar el botón.');
   assert.equal(await evaluate(fitsViewport),true,route+' '+w+': sin desbordamiento horizontal con la tarjeta.');
   assert.equal(await evaluate('(()=>{const b=document.querySelector("'+box+'").getBoundingClientRect(),c=document.querySelector("'+box+' .location-map-fallback").getBoundingClientRect();return c.height>0&&c.left>=b.left-1&&c.right<=b.right+1&&c.bottom<=b.bottom+1})()'),true,route+' '+w+': la tarjeta cabe en su contenedor.');
   await click(mapButton);await wait('!!document.querySelector("'+box+' iframe")');await sleep(300);
   assert.equal(externalBlocked.length,before+1,route+' '+w+': pulsar genera exactamente una petición al mapa.');
   assert.match(externalBlocked[externalBlocked.length-1].url,/^https:\/\/www\.google\.com\/maps\/embed/,'La única petición externa es el mapa de Google.');
   assert.equal(await evaluate(fitsViewport),true,route+' '+w+': sin desbordamiento horizontal con el mapa.');
   assert.equal(await evaluate('(()=>{const b=document.querySelector("'+box+'").getBoundingClientRect(),i=document.querySelector("'+box+' iframe").getBoundingClientRect(),r=document.querySelector("'+box+' .location-map-view-bar").getBoundingClientRect();return i.height>100&&r.height>0&&i.right<=b.right+1&&r.bottom<=b.bottom+1})()'),true,route+' '+w+': iframe y barra caben en el contenedor.');
   if(!mobile){
    // Desconexión simulada (navigator.onLine/evento offline en la página): el mapa se retira y la dirección vuelve; reconectar no lo reactiva.
    await evaluate('Object.defineProperty(navigator,"onLine",{configurable:true,get:()=>false});window.dispatchEvent(new Event("offline"))');
    await wait('!document.querySelector("'+box+' iframe")&&!!document.querySelector("'+box+' .location-map-fallback")');
    assert.ok(await evaluate('document.querySelector(".location-map-fallback-note").textContent.includes("Sin conexión")'),route+': aviso de conexión.');
    await click(mapButton);await sleep(300);
    assert.equal(await evaluate('document.querySelectorAll("iframe").length'),0,route+': sin conexión, pulsar no crea el iframe.');
    assert.equal(externalBlocked.length,before+1,route+': sin conexión no se inicia ninguna petición.');
    await evaluate('delete navigator.onLine;window.dispatchEvent(new Event("online"))');await sleep(500);
    assert.equal(await evaluate('document.querySelectorAll("iframe").length'),0,route+': reconectar no reactiva el mapa.');
    assert.equal(externalBlocked.length,before+1,route+': reconectar no lanza peticiones.');
    await click(mapButton);await wait('!!document.querySelector("'+box+' iframe")');await click('Ocultar mapa');await wait('!document.querySelector("'+box+' iframe")&&!!document.querySelector("'+box+' .location-map-fallback")');
    assert.equal(await evaluate('document.activeElement&&document.activeElement.tagName!=="IFRAME"'),true);
   }
  }
 }
 await send('Emulation.setDeviceMetricsOverride',{width:1440,height:1000,deviceScaleFactor:1,mobile:false});
 console.log('UI: mapa de ubicación (tarjeta inicial, sin peticiones antes de pulsar, desconexión sin reactivación, escritorio y móvil): OK.');
 // Las fuentes e iconos son locales: la única petición externa permitida es el iframe del mapa tras pulsar el botón.
 const leaks=externalBlocked.filter(b=>!/^https:\/\/www\.google\.com\/maps\/embed/.test(b.url));
 assert.equal(leaks.length,0,'Peticiones externas inesperadas: '+JSON.stringify(leaks.slice(0,3)));
 console.log('UI: '+externalBlocked.length+' peticiones externas, todas del mapa tras pulsar el botón y bloqueadas antes de enviarse; ninguna otra.');
 }finally{try{socket?.close()}catch{}cleanup?.()}}
main().catch(e=>{console.error(e.message);process.exitCode=1;server.close()});
