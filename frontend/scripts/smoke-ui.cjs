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
let chunkError=false,faqError=false,meUnavailable=false,attention={estado:'nuevo',responsable:'',notas:'',respuesta:'',revision:1,historial:[]},bodies=[],contactBodies=[];
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
 if(p==='/api/preguntas-frecuentes'&&faqError)return json({message:'Fallo de prueba'},503);
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
 await navigate('/educacion/cursos');await wait('document.body.innerText.includes("Curso de prueba")');assert.equal(await evaluate('document.body.innerText.includes("Capacitación de prueba")'),false);
 const courseCard='[...document.querySelectorAll("article.edu-card")].find(a=>a.textContent.includes("Curso de prueba"))';
 assert.equal(await evaluate('document.querySelector("h1").textContent'),'Cursos');assert.equal(await evaluate('document.querySelector(".horus-hero-eyebrow").textContent'),'Educación');
 assert.equal(await evaluate('document.body.innerText.includes("Actualizar catálogo")'),false,'El botón de desarrollo ya no existe.');
 assert.equal(await evaluate('Array.from(document.querySelectorAll(".edu-chip")).map(c=>c.textContent.replace(/\\s+/g," ").trim()).join("|")'),'Todas 1|Virtual 1','Los filtros salen de las modalidades reales.');
 assert.equal(await evaluate(courseCard+'.querySelector(".edu-facts").textContent.includes("Por confirmar")'),false,'Curso completo: sin campos por confirmar.');
 assert.equal(await evaluate(courseCard+'.querySelector("a[aria-label^=Consultar]").getAttribute("aria-label")'),'Consultar sobre Curso de prueba');
 await evaluate('Array.from(document.querySelectorAll(".edu-chip")).find(c=>c.textContent.includes("Virtual")).click()');await wait('document.querySelector(".edu-chip[aria-pressed=true]").textContent.includes("Virtual")&&document.querySelectorAll("article.edu-card").length===1');
 await click('Consultar');await wait('location.pathname==="/contactos"');assert.equal(await evaluate('document.getElementById("ct-asunto").value'),'Consulta sobre: Curso de prueba','Consultar conserva el nombre del curso como asunto.');
 await navigate('/educacion/cursos');await wait('document.body.innerText.includes("Curso de prueba")');await click('Ver detalle');await wait('location.pathname==="/educacion/cursos/1"&&document.body.innerText.includes("Temario de prueba")');
 assert.equal(await evaluate('document.querySelector("h1").textContent'),'Curso de prueba');
 await click('Solicitar información');await wait('document.getElementById("ct-asunto")?.value==="Consulta sobre: Curso de prueba"');
 await evaluate(`(()=>{const values={nombre:'Ana de prueba',email:'test@example.com',telefono:'+51 999 888 777',mensaje:'Consulta de prueba'};for(const [name,value] of Object.entries(values)){const el=document.getElementById('ct-'+name);Object.getOwnPropertyDescriptor(el.tagName==='TEXTAREA'?HTMLTextAreaElement.prototype:HTMLInputElement.prototype,'value').set.call(el,value);el.dispatchEvent(new Event('input',{bubbles:true}));}})()`);await sleep(100);await evaluate('document.getElementById("ct-nombre").form.requestSubmit()');await wait('document.body.innerText.includes("Recibimos tu mensaje. Gracias por escribirnos. No es necesario que lo envíes de nuevo.")');assert.equal(contactBodies.length,1);assert.equal(contactBodies[0].telefono,'+51 999 888 777');assert.equal(contactBodies[0].asunto,'Consulta sobre: Curso de prueba');
 await navigate('/preguntas-frecuentes');await wait('!!document.querySelector("details")');await evaluate('document.querySelector("summary").click()');assert.equal(await evaluate('document.querySelector("details").open'),true);
 faqError=true;await evaluate('window.dispatchEvent(new CustomEvent("horus:content-updated",{detail:"contenido-original"}))');await wait('!!document.querySelector("[role=alert]")');faqError=false;await click('Reintentar');await wait('!!document.querySelector("details")');
 console.log('UI: catálogo, consultas y FAQ comprobados.');
 await navigate('/galeria');await wait('!!document.querySelector(".gl-card")');await evaluate('document.querySelector(".gl-card").focus();document.querySelector(".gl-card").click()');await wait('!!document.querySelector("dialog[open]")');await send('Input.dispatchKeyEvent',{type:'keyDown',key:'Escape',code:'Escape',windowsVirtualKeyCode:27,nativeVirtualKeyCode:27});await wait('!document.querySelector("dialog[open]")');assert.equal(await evaluate('document.activeElement.classList.contains("gl-card")'),true);
 await navigate('/');await wait('!!document.querySelector(".home-conv-card")');await evaluate('document.querySelector(".home-conv-card").click()');await wait('!!document.querySelector("#home-conv-center #convDesc")');assert.equal(await evaluate('document.querySelector("#convNombre").textContent'),'Convenio de prueba');await evaluate('document.querySelector("#convClose").click()');await wait('!document.querySelector("#home-conv-center #convDesc")');
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
 await navigate('/tecnologias/cableado-estructurado');await wait('document.querySelectorAll("[role=tab]").length===4');
 await evaluate('document.querySelector("[role=tab]").focus()');await send('Input.dispatchKeyEvent',{type:'keyDown',key:'ArrowRight',code:'ArrowRight',windowsVirtualKeyCode:39,nativeVirtualKeyCode:39});
 await wait('document.querySelector("[role=tab][aria-selected=true]").textContent.includes("Cat 5e")');
 assert.equal(await evaluate('document.activeElement.getAttribute("aria-selected")'),"true");
 await wait('document.querySelector(".cable-panel-media img")?.naturalWidth>0');await capture('cableado-desktop','#categorias');
 await navigate('/tecnologias/camaras-seguridad');await wait('document.querySelectorAll(".cam-card").length===4');assert.equal(await evaluate('document.querySelectorAll(".cam-card-media").length'),4);await capture('camaras-desktop','#soluciones');
 const supportEntries=serviceEntries.filter(x=>x.categoria==='soporte');
 Object.assign(supportEntries[0],{presentacion:'mantenimiento',imagen_url:'/site-original/categoria1.jpg'});Object.assign(supportEntries[1],{presentacion:'software',imagen_url:'/site-original/categoria2.webp'});
 await navigate('/tecnologias/soporte-mantenimiento');await wait('document.querySelectorAll(".sop-card").length===4');
 await wait('Array.from(document.querySelectorAll(".sop-card-media img")).slice(0,2).every(i=>i.complete&&i.naturalWidth>0)');
 assert.deepEqual(await evaluate('Array.from(document.querySelectorAll(".sop-card-media img"),i=>new URL(i.src).pathname).slice(0,2)'),['/site-original/categoria1.jpg','/site-original/categoria2.webp'],'Soporte muestra la imagen del registro aunque su presentación sea mantenimiento o software.');
 assert.equal(await evaluate('!!document.querySelector(".sop-terminal,.sop-maint-cycle,.sop-card-visual")'),false,'No quedan ilustraciones fijas en Soporte.');await capture('soporte-desktop','#servicios');
 await navigate('/educacion/asesoramiento');await wait('document.querySelectorAll(".edu-card").length===3');assert.equal(await evaluate('document.querySelectorAll(".edu-benefit").length'),4);assert.equal(await evaluate('document.querySelector("h1").textContent'),'Asesoramiento');await capture('asesoramiento-desktop','#asesoramiento');
 await navigate('/educacion/capacitaciones');await wait('document.querySelectorAll(".edu-card").length===5');assert.equal(await evaluate('Array.from(document.querySelectorAll(".edu-card h3")).some(h=>h.textContent.includes("Capacitación de prueba"))'),true);assert.equal(await evaluate('document.querySelector("h1").textContent'),'Capacitaciones');await capture('capacitaciones-desktop','#catalogo');
 await navigate('/galeria');await wait('document.querySelectorAll(".gl-band-panel img").length>=1');await wait('document.querySelector(".gl-band-panel img")?.naturalWidth>0');await capture('galeria-carrusel','.gl-intro');
 await evaluate('Array.from(document.querySelectorAll(".gl-chip")).find(x=>x.textContent.trim()==="Capacitaciones").click()');await wait('document.querySelector(".gl-chip[aria-pressed=true]")?.textContent==="Capacitaciones"&&document.querySelector(".gl-grid")?.getAttribute("aria-busy")!=="true"');assert.equal(await evaluate('Array.from(document.querySelectorAll(".gl-card-cat")).every(x=>x.textContent==="Capacitaciones")'),true);await capture('galeria-desktop','#galeria');
 await send('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:true});
 for(const [route,selector] of [['/tecnologias/cableado-estructurado','#categorias'],['/tecnologias/camaras-seguridad','#soluciones'],['/tecnologias/soporte-mantenimiento','#servicios'],['/educacion/asesoramiento','#asesoramiento'],['/educacion/capacitaciones','#catalogo'],['/galeria','#galeria']]){
  await navigate(route);await wait('!document.querySelector("[role=status]")?.textContent.includes("Cargando")');await sleep(200);assert.equal(await evaluate('document.documentElement.scrollWidth<=innerWidth+1'),true,'Desbordamiento móvil: '+route);await capture(route.split('/').at(-1)+'-mobile',selector);
 }
 await send('Emulation.setDeviceMetricsOverride',{width:1440,height:1000,deviceScaleFactor:1,mobile:false});
 await evaluate('localStorage.setItem("horus-admin-token","isolated-ui-test-token")');
 await navigate('/tecnologias/cableado-estructurado');await wait('document.querySelectorAll("[role=tab]").length===4');
 // A second real tab saves the panel form. The open public tab receives the browser storage event.
 const adminTarget=await fetch('http://127.0.0.1:'+port+'/json/new?about:blank',{method:'PUT'}).then(r=>r.json());
 const adminSocket=new WebSocket(adminTarget.webSocketDebuggerUrl);await new Promise((r,j)=>{adminSocket.onopen=r;adminSocket.onerror=j});
 let adminSeq=0;const adminPending=new Map();adminSocket.onmessage=e=>{const m=JSON.parse(e.data);if(interceptExternal(m,origin,adminSend))return;if(m.id){const pending=adminPending.get(m.id);adminPending.delete(m.id);m.error?pending?.reject(new Error(m.error.message)):pending?.resolve(m.result)}};
 const adminSend=(method,params={})=>new Promise((resolve,reject)=>{const id=++adminSeq;adminPending.set(id,{resolve,reject});adminSocket.send(JSON.stringify({id,method,params}))});
 const adminEval=async expression=>{const result=await adminSend('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});if(result.exceptionDetails)throw new Error((result.exceptionDetails.exception?.description||result.exceptionDetails.text)+' :: '+expression.slice(0,240));return result.result.value};
 const adminWait=async expression=>{for(let i=0;i<100;i++){if(await adminEval(expression))return;await sleep(100)}const detail=await adminEval('document.querySelector(".hp-error")?.textContent||""').catch(()=>'');throw new Error('Panel: '+expression+(detail?' :: '+detail:''))};
 await adminSend('Page.enable');await adminSend('Fetch.enable',{patterns:[{urlPattern:'*'}]});await adminSend('Page.navigate',{url:origin+'/admin/dashboard?section=servicios'});
 try{
  await adminWait('document.querySelectorAll(".hw-resource").length===8');
  await adminEval('document.querySelector(".hw-resource footer button").click()');await adminWait('!!document.getElementById("field-nombre_corto")');
  await adminEval(`(()=>{for(const [name,value] of Object.entries({titulo:'Servicio actualizado desde el panel',nombre_corto:'Cat editable',etiquetas:'Etiqueta actualizada'})){const el=document.getElementById('field-'+name);Object.getOwnPropertyDescriptor(el.tagName==='TEXTAREA'?HTMLTextAreaElement.prototype:HTMLInputElement.prototype,'value').set.call(el,value);el.dispatchEvent(new Event('input',{bubbles:true}));}})()`);
  await sleep(100);await adminEval('document.querySelector("dialog form").requestSubmit()');await adminWait('document.body.innerText.includes("Cambios guardados correctamente.")&&!document.querySelector("dialog[open]")');
  await wait('document.querySelector(".cable-panel-info h3")?.textContent==="Servicio actualizado desde el panel"');assert.equal(await evaluate('document.querySelector("[role=tab]").textContent.includes("Cat editable")'),true);assert.equal(await evaluate('document.querySelector(".cable-panel-info .tech-chips li").textContent'),"Etiqueta actualizada");
  await adminEval('Array.from(document.querySelectorAll("button")).find(x=>x.textContent.trim()==="Recuperar contenido original").click()');
  await adminWait('document.querySelector(".original-import-list")?.children.length===19');
  await adminEval('Array.from(document.querySelectorAll("dialog button")).find(x=>x.textContent.trim()==="Recuperar registros").click()');
  await adminWait('document.body.innerText.includes("0 registros recuperados.")');assert.deepEqual(importBodies,[{estado:'publicado'}]);
  assert.equal(serviceEntries[0].titulo,'Servicio actualizado desde el panel');
  // A fresh load of the services panel: the 12 technology records, 8 per page.
  await adminSend('Page.navigate',{url:origin+'/admin/dashboard?section=servicios'});
  await adminWait('document.querySelectorAll(".hw-resource").length===8');
  const typeInto=(id,value)=>adminEval('(()=>{const el=document.getElementById('+JSON.stringify(id)+');Object.getOwnPropertyDescriptor(el.tagName==="TEXTAREA"?HTMLTextAreaElement.prototype:HTMLInputElement.prototype,"value").set.call(el,'+JSON.stringify(value)+');el.dispatchEvent(new Event("input",{bubbles:true}))})()');
  // Regression: a record created on a page other than the first one used to look lost. The slug also follows the title.
  await adminEval('Array.from(document.querySelectorAll(".hp-heading button")).find(x=>x.textContent.includes("Crear servicio")).click()');
  await adminWait('!!document.getElementById("field-titulo")');
  await typeInto('field-titulo','Servicio al final de la lista');
  await adminWait('document.getElementById("field-slug").value==="servicio-al-final-de-la-lista"');
  await typeInto('field-descripcion','Servicio de prueba creado desde el panel');
  await sleep(100);await adminEval('document.querySelector("dialog form").requestSubmit()');
  await adminWait('document.body.innerText.includes("Se creó «Servicio al final de la lista»")&&document.body.innerText.includes("página 2")');
  await adminWait('Array.from(document.querySelectorAll(".hw-resource h3")).some(h=>h.textContent==="Servicio al final de la lista")');
  assert.equal(await adminEval('document.querySelector(".hp-pagination").textContent.includes("2 / 2")'),true,'El panel abre la página donde quedó el servicio nuevo.');
  // The services menu opens from the section and splits the records by section.
  assert.equal(await adminEval('Array.from(document.querySelectorAll(".hp-nav-item")).find(x=>x.textContent.includes("Servicios tecnológicos")).getAttribute("aria-expanded")'),'true');
  assert.deepEqual(await adminEval('Array.from(document.querySelectorAll(".hp-nav-subitem"),x=>x.textContent)'),['Cableado estructurado','Cámaras de seguridad','Soporte y mantenimiento']);
  await adminEval('Array.from(document.querySelectorAll(".hp-nav-subitem")).find(x=>x.textContent==="Cableado estructurado").click()');
  await adminWait('location.search.includes("seccion=cableado")&&document.querySelector("h1").textContent==="Cableado estructurado"&&document.querySelectorAll(".hw-resource").length===5');
  assert.equal(await adminEval('document.querySelector(".hp-nav-subitem.is-active").getAttribute("aria-current")'),'page');
  // Creating inside a section keeps the record in that section.
  await adminEval('Array.from(document.querySelectorAll(".hp-nav-subitem")).find(x=>x.textContent==="Soporte y mantenimiento").click()');
  await adminWait('location.search.includes("seccion=soporte")&&document.querySelectorAll(".hw-resource").length===4');
  await adminEval('Array.from(document.querySelectorAll(".hp-heading button")).find(x=>x.textContent.includes("Crear servicio")).click()');
  await adminWait('!!document.getElementById("field-titulo")');
  assert.equal(await adminEval('!!document.getElementById("field-categoria")'),false,'La categoría de la sección queda fijada: no hay selector.');
  await adminEval('document.querySelector("dialog header button").click()');await adminWait('!document.querySelector("dialog[open]")');
  // Deleting a service removes it for real (it does not stay archived) and asks for confirmation first.
  const parent='Array.from(document.querySelectorAll(".hp-nav-item")).find(x=>x.textContent.includes("Servicios tecnológicos"))';
  await adminEval(parent+'.click()');await adminWait(parent+'.getAttribute("aria-expanded")==="false"&&!document.querySelector(".hp-nav-subitem")');
  await adminEval(parent+'.click()');await adminWait(parent+'.getAttribute("aria-expanded")==="true"&&document.querySelectorAll(".hp-nav-subitem").length===3');
  await adminEval('Array.from(document.querySelectorAll(".hp-nav-subitem")).find(x=>x.textContent==="Cableado estructurado").click()');
  await adminWait('location.search.includes("seccion=cableado")&&document.querySelectorAll(".hw-resource").length===5');
  const created=serviceEntries.find(x=>x.titulo==='Servicio al final de la lista');assert.ok(created&&created.categoria==='cableado');
  await adminEval('(()=>{const card=Array.from(document.querySelectorAll(".hw-resource")).find(x=>x.querySelector("h3").textContent==="Servicio al final de la lista");card.querySelector("button[aria-label^=Eliminar]").click()})()');
  await adminWait('document.body.innerText.includes("Se eliminará definitivamente")&&document.body.innerText.includes("Servicio al final de la lista")');
  assert.equal(serviceDeletes.length,0,'Nada se elimina antes de confirmar.');
  await adminEval('Array.from(document.querySelectorAll("dialog button")).find(x=>x.textContent.trim()==="Eliminar definitivamente").click()');
  await adminWait('document.body.innerText.includes("Servicio eliminado definitivamente.")&&document.querySelectorAll(".hw-resource").length===4');
  assert.deepEqual(serviceDeletes,[created.id]);assert.equal(serviceEntries.some(x=>x.id===created.id),false);
  // The three technology categories are the only ones the panel offers: create, edit, publish and delete in each.
  assert.equal(await adminEval('Array.from(document.querySelectorAll("button, a, option")).some(x=>/otros/i.test(x.textContent))'),false,'Otros servicios ya no aparece en el panel.');
  for(const [name,key] of [['Cableado estructurado','cableado'],['Cámaras de seguridad','camaras'],['Soporte y mantenimiento','soporte']]){
   const title='Prueba '+key,pick=(id,value)=>adminEval('(()=>{const s=document.getElementById('+JSON.stringify(id)+');Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype,"value").set.call(s,'+JSON.stringify(value)+');s.dispatchEvent(new Event("change",{bubbles:true}))})()');
   const card=(text)=>'Array.from(document.querySelectorAll(".hw-resource")).find(x=>x.querySelector("h3").textContent==='+JSON.stringify(text)+')';
   await adminEval('Array.from(document.querySelectorAll(".hp-nav-subitem")).find(x=>x.textContent==='+JSON.stringify(name)+').click()');
   await adminWait('location.search.includes("seccion='+key+'")&&document.querySelector("h1").textContent==='+JSON.stringify(name));
   await adminEval('Array.from(document.querySelectorAll(".hp-heading button")).find(x=>x.textContent.includes("Crear servicio")).click()');
   await adminWait('!!document.getElementById("field-titulo")');
   assert.equal(await adminEval('!!document.getElementById("field-categoria")'),false,name+': la categoría ya está fijada.');
   await typeInto('field-titulo',title);await typeInto('field-descripcion','Descripción de '+title);
   await sleep(100);await adminEval('document.querySelector("dialog form").requestSubmit()');
   await adminWait('document.body.innerText.includes("Se creó «'+title+'»")&&!!'+card(title));
   const record=serviceEntries.find(x=>x.titulo===title);assert.ok(record&&record.categoria===key&&record.estado==='borrador','Se crea como borrador en '+name+'.');
   await adminEval(card(title)+'.querySelector("footer button").click()');
   await adminWait('document.getElementById("field-titulo")?.value===' + JSON.stringify(title));
   assert.equal(await adminEval('!!document.getElementById("field-categoria")'),false,'Editar tampoco muestra la categoría.');
   await typeInto('field-titulo',title+' editada');await pick('field-estado','publicado');
   await sleep(100);await adminEval('document.querySelector("dialog form").requestSubmit()');
   await adminWait('(()=>{const c='+card(title+' editada')+';return !!c&&c.textContent.includes("Publicado")})()');
   assert.ok(record.titulo===title+' editada'&&record.estado==='publicado'&&record.categoria===key,'La edición publica sin cambiar de categoría.');
   assert.ok(!('categoria' in serviceBodies.at(-1).body),'Editar no reenvía la categoría fijada.');
   await adminEval(card(title+' editada')+'.querySelector("button[aria-label^=Eliminar]").click()');
   await adminWait('document.body.innerText.includes("Se eliminará definitivamente")');
   await adminEval('Array.from(document.querySelectorAll("dialog button")).find(x=>x.textContent.trim()==="Eliminar definitivamente").click()');
   await adminWait('document.body.innerText.includes("Servicio eliminado definitivamente.")&&!'+card(title+' editada'));
   assert.ok(serviceDeletes.includes(record.id)&&!serviceEntries.some(x=>x.id===record.id),'Se elimina de verdad.');
  }
  // ---- Forms show only the fields of each kind of content; hidden stored values are never overwritten ----
  const fieldIds=()=>adminEval('Array.from(document.querySelectorAll("dialog form [id^=field-]"),x=>x.id.slice(6)).sort()');
  const sorted=list=>[...list].sort();
  const pickValue=(id,value)=>adminEval('(()=>{const s=document.getElementById('+JSON.stringify(id)+');Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype,"value").set.call(s,'+JSON.stringify(value)+');s.dispatchEvent(new Event("change",{bubbles:true}))})()');
  const submitForm=async()=>{await sleep(100);await adminEval('document.querySelector("dialog form").requestSubmit()')};
  const openCreate=async text=>{await adminEval('Array.from(document.querySelectorAll(".hp-heading button")).find(x=>x.textContent.includes('+JSON.stringify(text)+')).click()');await adminWait('!!document.getElementById("field-titulo")')};
  const openEdit=async title=>{
   // Records can sit on another page of the list (8 per page): go to the first page that holds it.
   const has='Array.from(document.querySelectorAll(".hw-resource h3")).some(h=>h.textContent==='+JSON.stringify(title)+')';
   const turn=label=>adminEval('(()=>{const b=Array.from(document.querySelectorAll(".hp-pagination button")).find(x=>x.textContent==='+JSON.stringify(label)+');if(b&&!b.disabled){b.click();return true}return false})()');
   for(let n=0;n<4&&await turn('Anterior');n++)await sleep(400);
   for(let n=0;n<4&&!(await adminEval(has));n++){await adminEval('(()=>{const b=Array.from(document.querySelectorAll(".hp-pagination button")).find(x=>x.textContent==="Siguiente");if(b&&!b.disabled)b.click()})()');await sleep(400)}
   await adminEval('(()=>{const card=Array.from(document.querySelectorAll(".hw-resource")).find(x=>x.querySelector("h3").textContent==='+JSON.stringify(title)+');card.querySelector("footer button").click()})()');await adminWait('document.getElementById("field-titulo")?.value==='+JSON.stringify(title))};
  const goSub=async(label,key)=>{await adminEval('Array.from(document.querySelectorAll(".hp-nav-subitem")).find(x=>x.textContent==='+JSON.stringify(label)+').click()');await adminWait('location.search.includes("seccion='+key+'")&&document.querySelector("h1").textContent==='+JSON.stringify(label))};
  const hidden=['color','presentacion','categoria','contenido_tipo','tipo'];
  const common=['titulo','descripcion','imagen_url','orden','estado','slug'];
  await adminEval('Array.from(document.querySelectorAll(".hp-nav-item")).find(x=>x.textContent.includes("Servicios tecnológicos")).getAttribute("aria-expanded")==="true"||Array.from(document.querySelectorAll(".hp-nav-item")).find(x=>x.textContent.includes("Servicios tecnológicos")).click()');
  await adminWait('document.querySelectorAll(".hp-nav-subitem").length===3');
  const expected={cableado:[...common,'nombre_corto','icono','destacado','dato_principal','dato_secundario','etiquetas','alcance'],camaras:[...common,'icono','destacado','etiquetas','alcance'],soporte:[...common,'icono','destacado','etiquetas','alcance']};
  const labels={cableado:'Cableado estructurado',camaras:'Cámaras de seguridad',soporte:'Soporte y mantenimiento'};
  for(const key of ['cableado','camaras','soporte']){
   await goSub(labels[key],key);
   await openCreate('Crear servicio');
   assert.deepEqual(await fieldIds(),sorted(expected[key]),key+': campos del formulario.');
   assert.equal(await adminEval('document.querySelector(".hp-advanced summary").textContent'),'Opciones avanzadas');
   assert.equal(await adminEval('document.querySelector(".hp-advanced").open'),false,'El slug queda en opciones avanzadas, cerrado.');
   if(key!=='cableado')assert.equal(await adminEval('document.querySelector("label[for=field-destacado]").textContent.includes("Insignia de la imagen")'),true);
   assert.equal(await adminEval('document.querySelector("#field-icono option:first-child").textContent'),'Sin icono');
   // UX: Guardar is always in view (sticky footer) and the sections are titled.
   assert.equal(await adminEval('document.querySelector(".hp-dialog-footer").getBoundingClientRect().bottom<=innerHeight'),true,key+': Guardar siempre a la vista.');
   assert.deepEqual(await adminEval('Array.from(document.querySelectorAll(".hp-form-section > h3"),x=>x.textContent)'),['Información principal','Contenido','Publicación'],key+': secciones del formulario.');
   if(key==='cableado'){
    // A slug that cannot be built from the title opens "Opciones avanzadas" and the error shows next to Guardar.
    await typeInto('field-titulo','!!');await typeInto('field-descripcion','x');await submitForm();
    await adminWait('!!document.querySelector(".hp-dialog-footer .hp-error")&&document.querySelector(".hp-advanced").open');
    assert.equal(await adminEval('document.querySelector(".hp-dialog-footer .hp-error").textContent.includes("slug")'),true);
   }
   const title='Forma '+key;await typeInto('field-titulo',title);await typeInto('field-descripcion','Descripción de '+title);
   if(key==='camaras'){await typeInto('field-destacado','NUEVO');}
   await submitForm();await adminWait('document.body.innerText.includes("Se creó «'+title+'»")');
   const posted=serviceBodies.at(-1);assert.equal(posted.method,'POST');
   assert.equal(posted.body.categoria,key,'La categoría fijada se envía al crear.');assert.equal(posted.body.slug,'forma-'+key,'El slug sale del título.');
   for(const name of ['color','presentacion','contenido_tipo','nombre_corto','dato_principal','dato_secundario'])assert.ok(!(name in posted.body),key+': no se envía '+name+' si está vacío o oculto.');
   if(key==='camaras')assert.equal(posted.body.destacado,'NUEVO');else assert.ok(!('destacado' in posted.body),'La insignia es opcional.');
  }
  // Editing keeps hidden values: they are not part of the form, so they are not sent (and never sent empty).
  const camHidden=serviceEntries.find(x=>x.categoria==='camaras'&&!x.titulo.startsWith('Forma'));
  Object.assign(camHidden,{color:'coral',presentacion:'camara',nombre_corto:'Pestaña oculta',dato_principal:'99',dato_secundario:'Mbps ocultos'});
  await goSub(labels.camaras,'camaras');await adminWait('document.querySelectorAll(".hw-resource").length>0');
  const editTarget=camHidden.titulo;
  await openEdit(editTarget);
  await typeInto('field-etiquetas','Etiqueta nueva');await submitForm();await adminWait('document.body.innerText.includes("Cambios guardados correctamente.")&&!document.querySelector("dialog[open]")');
  const edited=serviceBodies.at(-1);assert.equal(edited.method,'PUT');
  for(const name of ['color','presentacion','nombre_corto','dato_principal','dato_secundario','categoria','limpiar'])assert.ok(!(name in edited.body),'Editar no envía el campo oculto '+name+'.');
  assert.equal(edited.body.etiquetas,'Etiqueta nueva');
  assert.deepEqual([camHidden.color,camHidden.presentacion,camHidden.nombre_corto,camHidden.dato_principal,camHidden.dato_secundario],['coral','camara','Pestaña oculta','99','Mbps ocultos'],'Los valores ocultos siguen guardados.');
  // Clearing a visible optional field does clear it, and only that one.
  await openEdit(editTarget);await typeInto('field-etiquetas','');await submitForm();await adminWait('document.body.innerText.includes("Cambios guardados correctamente.")&&!document.querySelector("dialog[open]")');
  assert.deepEqual(serviceBodies.at(-1).body.limpiar,['etiquetas']);assert.equal(camHidden.etiquetas,null);assert.equal(camHidden.color,'coral');
  // Asesoramiento: line / benefit, stored internally in presentacion.
  await adminEval('Array.from(document.querySelectorAll(".hp-nav-item")).find(x=>x.textContent.includes("Educación")).click()');
  await adminWait('document.querySelectorAll(".hp-nav-subitem").length===3&&Array.from(document.querySelectorAll(".hp-nav-subitem"),x=>x.textContent).includes("Asesoramiento")');
  await goSub('Asesoramiento','asesoramiento');
  await openCreate('Crear servicio');
  assert.deepEqual(await fieldIds(),sorted([...common,'contenido_tipo','icono','alcance']),'Asesoramiento (línea): campos.');
  assert.deepEqual(await adminEval('Array.from(document.getElementById("field-contenido_tipo").options,x=>x.textContent)'),['Línea de asesoramiento','Beneficio (Por qué elegirnos)']);
  assert.equal(await adminEval('document.querySelector("label[for=field-alcance]").textContent.includes("Alcance / Qué incluye")'),true);
  await typeInto('field-titulo','Línea de prueba');await typeInto('field-descripcion','Descripción de la línea');await typeInto('field-alcance','Incluye uno\nIncluye dos');
  await submitForm();await adminWait('document.body.innerText.includes("Se creó «Línea de prueba»")');
  let sent=serviceBodies.at(-1).body;assert.equal(sent.categoria,'asesoramiento');assert.equal(sent.presentacion,'asesoria');assert.ok(!('color' in sent)&&!('etiquetas' in sent));
  await openCreate('Crear servicio');
  await pickValue('field-contenido_tipo','beneficio');
  await adminWait('!document.getElementById("field-alcance")');
  assert.deepEqual(await fieldIds(),sorted(['titulo','contenido_tipo','descripcion','icono','orden','estado','slug']),'Beneficio: sin imagen ni alcance.');
  await typeInto('field-titulo','Beneficio de prueba');await typeInto('field-descripcion','Por qué elegirnos de prueba');
  await submitForm();await adminWait('document.body.innerText.includes("Se creó «Beneficio de prueba»")');
  sent=serviceBodies.at(-1).body;assert.equal(sent.presentacion,'beneficio');assert.equal(sent.categoria,'asesoramiento');assert.ok(!('alcance' in sent)&&!('imagen_url' in sent));
  // Editing a line without touching the type does not rewrite presentacion; changing it does.
  await openEdit('Línea de prueba');assert.equal(await adminEval('document.getElementById("field-contenido_tipo").value'),'linea');
  await typeInto('field-descripcion','Descripción editada');await submitForm();await adminWait('document.body.innerText.includes("Cambios guardados correctamente.")&&!document.querySelector("dialog[open]")');
  assert.ok(!('presentacion' in serviceBodies.at(-1).body),'Sin cambiar el tipo no se toca presentacion.');
  await openEdit('Beneficio de prueba');assert.equal(await adminEval('document.getElementById("field-contenido_tipo").value'),'beneficio');
  await pickValue('field-contenido_tipo','linea');await submitForm();await adminWait('document.body.innerText.includes("Cambios guardados correctamente.")&&!document.querySelector("dialog[open]")');
  assert.equal(serviceBodies.at(-1).body.presentacion,'asesoria');
  await openEdit('Beneficio de prueba');await pickValue('field-contenido_tipo','beneficio');await submitForm();await adminWait('document.body.innerText.includes("Cambios guardados correctamente.")&&!document.querySelector("dialog[open]")');
  assert.equal(serviceBodies.at(-1).body.presentacion,'beneficio');
  // Courses and capacitaciones.
  const courseFields=['titulo','descripcion','imagen_url','modalidad','duracion','fecha_inicio','area','certificacion','temario','orden','estado','slug'];
  await goSub('Cursos','cursos');await openCreate('Crear');
  assert.deepEqual(await fieldIds(),sorted(courseFields),'Cursos: campos.');
  assert.equal(await adminEval('document.querySelector("label[for=field-modalidad]").textContent.includes("*")&&document.querySelector("label[for=field-duracion]").textContent.includes("*")'),true,'Curso: modalidad y duración obligatorias.');
  await typeInto('field-titulo','Curso de forma');await typeInto('field-descripcion','Descripción del curso');await pickValue('field-modalidad','virtual');await typeInto('field-duracion','10 horas');await typeInto('field-area','Ofimática');
  await submitForm();await adminWait('document.body.innerText.includes("Se creó «Curso de forma»")');
  let course=courseBodies.at(-1).body;assert.equal(course.tipo,'curso');assert.equal(course.slug,'curso-de-forma');assert.equal(course.area,'Ofimática');
  for(const name of ['color','icono','certificacion','temario','fecha_inicio'])assert.ok(!(name in course),'Curso: no se envía '+name+' vacío.');
  await goSub('Capacitaciones','capacitaciones');await openCreate('Crear');
  assert.deepEqual(await fieldIds(),sorted(courseFields),'Capacitaciones: mismos campos.');
  assert.equal(await adminEval('document.querySelector("label[for=field-modalidad]").textContent.includes("*")'),false,'Capacitación: modalidad opcional.');
  await typeInto('field-titulo','Capacitación de forma');await typeInto('field-descripcion','Descripción de la capacitación');
  await submitForm();await adminWait('document.body.innerText.includes("Se creó «Capacitación de forma»")');
  course=courseBodies.at(-1).body;assert.equal(course.tipo,'capacitacion');assert.ok(!('modalidad' in course)&&!('duracion' in course));
  fixtureCap.icono='star';fixtureCap.color='coral';fixtureCap.area='Área guardada';
  await openEdit('Capacitación de prueba');await typeInto('field-certificacion','Certificado oficial');await submitForm();await adminWait('document.body.innerText.includes("Cambios guardados correctamente.")&&!document.querySelector("dialog[open]")');
  course=courseBodies.at(-1).body;assert.equal(course.certificacion,'Certificado oficial');
  for(const name of ['icono','color','tipo','limpiar'])assert.ok(!(name in course),'Editar no envía '+name+'.');
  assert.deepEqual([fixtureCap.icono,fixtureCap.color,fixtureCap.area],['star','coral','Área guardada'],'Los valores ocultos de la capacitación siguen guardados.');
  // The public pages render what the panel just created, with and without the optional extras.
  await navigate('/tecnologias/camaras-seguridad');await wait('Array.from(document.querySelectorAll(".cam-card h3")).some(h=>h.textContent==="Forma camaras")');
  assert.equal(await evaluate('(()=>{const c=Array.from(document.querySelectorAll(".cam-card")).find(x=>x.querySelector("h3").textContent==="Forma camaras");return c.querySelector(".tech-badge")?.textContent})()'),'Nuevo','La insignia se muestra (en mayúsculas por estilo).');
  assert.equal(await evaluate('Array.from(document.querySelectorAll(".cam-card")).filter(c=>!c.querySelector(".tech-badge")).length>0'),true,'Las tarjetas sin insignia se ven completas.');
  await navigate('/educacion/asesoramiento');await wait('Array.from(document.querySelectorAll(".edu-card h3")).some(h=>h.textContent==="Línea de prueba")&&Array.from(document.querySelectorAll(".edu-benefit h3")).some(h=>h.textContent==="Beneficio de prueba")');
  await navigate('/educacion/cursos');await wait('Array.from(document.querySelectorAll(".edu-card h3")).some(h=>h.textContent==="Curso de forma")');
  assert.equal(await evaluate('Array.from(document.querySelectorAll(".edu-card")).find(c=>c.querySelector("h3").textContent==="Curso de forma").textContent.includes("Por confirmar")'),true,'Inicio por confirmar en el curso nuevo.');
  await navigate('/educacion/capacitaciones');await wait('Array.from(document.querySelectorAll(".edu-card h3")).some(h=>h.textContent==="Capacitación de forma")');
  // Leave the fixtures as they were for the checks that follow.
  for(const list of [serviceEntries,courseEntries])for(let i=list.length-1;i>=0;i--)if(/^(Forma |Línea de prueba|Beneficio de prueba|Curso de forma|Capacitación de forma)/.test(list[i].titulo))list.splice(i,1);
  for(const name of ['color','presentacion','nombre_corto','dato_principal','dato_secundario'])delete camHidden[name];
  delete fixtureCap.icono;delete fixtureCap.color;delete fixtureCap.area;delete fixtureCap.certificacion;
  // Back to the technology services group, as the Education menu check below expects.
  await adminEval('Array.from(document.querySelectorAll(".hp-nav-item")).find(x=>x.textContent.includes("Servicios tecnológicos")).click()');
  await adminWait('location.search.includes("section=servicios")&&document.querySelectorAll(".hp-nav-subitem").length===3&&Array.from(document.querySelectorAll(".hp-nav-subitem"),x=>x.textContent).includes("Soporte y mantenimiento")');
  fixtureCap.estado='archivado'; // archived records remain available for editing and republication
  // Education menu: Asesoramiento, Capacitaciones and Cursos are separate sections of one group.
  await adminEval('Array.from(document.querySelectorAll(".hp-nav-item")).find(x=>x.textContent.includes("Educación")).click()');
  await adminWait('location.search.includes("section=educacion")&&location.search.includes("seccion=asesoramiento")&&document.querySelectorAll(".hp-nav-subitem").length===3');
  assert.deepEqual(await adminEval('Array.from(document.querySelectorAll(".hp-nav-subitem"),x=>x.textContent)'),['Asesoramiento','Capacitaciones','Cursos'],'El menú de servicios se pliega al cambiar de grupo.');
  await adminEval('Array.from(document.querySelectorAll(".hp-nav-subitem")).find(x=>x.textContent==="Asesoramiento").click()');
  await adminWait('location.search.includes("seccion=asesoramiento")&&document.querySelector("h1").textContent==="Asesoramiento"&&document.querySelectorAll(".hw-resource").length===7');
  assert.equal(await adminEval('document.querySelector(".hp-kicker").textContent'),'EDUCACIÓN');
  for(const [name,key,tipo] of [['Capacitaciones','capacitaciones','capacitacion'],['Cursos','cursos','curso']]){
   await sleep(600);adminCourseRequests.length=0; // let requests still in flight from the previous section arrive first
   await adminEval('Array.from(document.querySelectorAll(".hp-nav-subitem")).find(x=>x.textContent==='+JSON.stringify(name)+').click()');
   await adminWait('location.search.includes("seccion='+key+'")&&document.querySelector("h1").textContent==='+JSON.stringify(name)+'&&document.querySelectorAll(".hw-resource").length>0');
   assert.ok(adminCourseRequests.length>0&&adminCourseRequests.every(search=>new URLSearchParams(search).get('tipo')===tipo),name+' solo consulta registros de su tipo.');
   await adminEval('Array.from(document.querySelectorAll(".hp-heading button")).find(x=>x.textContent.includes("Crear")).click()');
   await adminWait('!!document.getElementById("field-titulo")');
   assert.equal(await adminEval('!!document.getElementById("field-tipo")'),false,name+': el tipo ya está fijado por la sección.');
   await adminEval('document.querySelector("dialog header button").click()');await adminWait('!document.querySelector("dialog[open]")');
   // Editing cannot move a record to the other section: the type is fixed.
   await adminEval('(()=>{const card=Array.from(document.querySelectorAll(".hw-resource")).find(x=>x.querySelector("h3").textContent===' + JSON.stringify(tipo==='curso'?'Curso de prueba':'Capacitación de prueba') + ');card.querySelector("footer button").click()})()');
   await adminWait('!!document.getElementById("field-titulo")');
   assert.equal(await adminEval('!!document.getElementById("field-tipo")'),false,name+': editar tampoco permite cambiar el tipo.');
   await adminEval('document.querySelector("dialog header button").click()');await adminWait('!document.querySelector("dialog[open]")');
   // There is no DELETE action. Archive and republish the same record through the existing editor.
   const sample=tipo==='curso'?fixtureCourse:fixtureCap;
   const slug=sample.slug;
   assert.equal(await adminEval('!!document.querySelector(".hw-resource button[aria-label^=Eliminar], .hw-resource button[aria-label^=Archivar]")'),false,name+': sin acción DELETE.');
   for(const estado of ['archivado','publicado']){
    await openEdit(sample.titulo);await pickValue('field-estado',estado);await submitForm();
    await adminWait('!document.querySelector("dialog[open]")&&document.body.innerText.includes("Cambios guardados correctamente.")');
    assert.equal(courseBodies.at(-1).method,'PUT');assert.equal(courseBodies.at(-1).id,sample.id);assert.equal(courseBodies.at(-1).body.estado,estado);
    assert.equal(courseEntries.find(x=>x.id===sample.id).slug,slug);assert.equal(sample.estado,estado);
   }
   assert.deepEqual(courseDeletes,[],name+': no se envía DELETE y se conserva el registro.');
  }
  // The old address no longer mixes both: it opens Cursos only.
  adminCourseRequests.length=0;
  await adminSend('Page.navigate',{url:origin+'/admin/dashboard?section=cursos'});
  await adminWait('document.querySelector("h1")?.textContent==="Cursos"&&document.querySelectorAll(".hp-nav-subitem").length===3');
  // The list must have finished loading (no "Cargando" status, footer rendered) before the request log is read; the h1 and the menu appear earlier.
  await adminWait('location.search==="?section=cursos"&&!document.querySelector(".hp-empty[role=status]")&&!!document.querySelector(".hp-pagination")&&!document.querySelector(".hp-empty[role=alert]")');
  assert.ok(adminCourseRequests.length>0&&adminCourseRequests.every(search=>new URLSearchParams(search).get('tipo')==='curso'),'La dirección antigua solo muestra cursos. Solicitudes registradas: '+JSON.stringify(adminCourseRequests));
  // Sidebar: Ajustes replaces "Cuentas y acceso" and "Crear administrador".
  await adminSend('Page.navigate',{url:origin+'/admin/dashboard?section=resumen'});
  await adminWait('!!document.querySelector(".hp-sidebar-bottom")');
  const sidebarText=await adminEval('document.querySelector("#panel-sidebar").textContent');
  assert.ok(!/Cuentas y acceso|Crear administrador/.test(sidebarText),'Cuentas y acceso y Crear administrador ya no están en el menú.');
  assert.ok(sidebarText.includes('Información de empresa'));assert.equal(await adminEval('!!document.querySelector("#panel-sidebar a[href=\\"/admin/register\\"]")'),false);
  assert.deepEqual(await adminEval('Array.from(document.querySelectorAll(".hp-sidebar-bottom > *"),x=>x.textContent.trim())'),['Ajustes','Visitar sitio web','Cerrar sesión']);
  // The overview keeps courses and capacitaciones apart.
  await adminWait('document.querySelectorAll(".hp-distribution-row").length>0');
  const rows=await adminEval('Array.from(document.querySelectorAll(".hp-distribution-row"),x=>x.textContent)');
  assert.ok(rows.some(x=>x.startsWith('Capacitaciones')&&x.includes('2'))&&rows.some(x=>x.startsWith('Cursos')&&x.includes('1')),'Capacitaciones y Cursos aparecen por separado en el resumen.');
  assert.ok(!(await adminEval('document.querySelector(".hp-distribution").textContent')).includes('Cursos y capacitaciones'));
  await adminSend('Page.navigate',{url:origin+'/admin/dashboard?section=cuentas'});
  await adminWait('document.querySelector("h1")&&document.querySelector("h1").textContent!==""');
  assert.notEqual(await adminEval('document.querySelector("h1").textContent'),'Cuentas y acceso','La dirección antigua ya no abre la pantalla de cuentas.');
  await adminEval('Array.from(document.querySelectorAll(".hp-sidebar-bottom button")).find(x=>x.textContent.includes("Ajustes")).click()');
  await adminWait('location.search.includes("section=configuracion")&&document.querySelector("h1").textContent==="Ajustes"');
  assert.equal(await adminEval('document.querySelector(".hp-sidebar-bottom button").getAttribute("aria-current")'),'page');
  assert.equal(await adminEval('document.querySelector(".hp-heading p:not(.hp-kicker)").textContent'),'Configura las preferencias de tu cuenta y del panel.');
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
 console.log('UI: diseño original, pestañas con teclado, carrusel, filtros, móvil, importación y edición del panel reflejada en otra pestaña: OK.');

 await navigate('/admin/dashboard?section=cotizaciones');await wait('Array.from(document.querySelectorAll("button")).some(x=>x.textContent.trim()==="Ver propuesta"&&!x.disabled)');await click('Ver propuesta');await wait('!!document.querySelector(".hq-document")');assert.ok(await evaluate('document.querySelector(".hq-document").textContent.includes("118.00")'));await click('Enviar por correo');await wait('document.body.innerText.includes("No se pudo enviar el correo de prueba.")');await evaluate('document.querySelector("dialog header button").click()');
 await navigate('/admin/messages');await wait('document.body.innerText.includes("Consulta de prueba")');await evaluate('document.querySelector(".hw-inbox-list button").click()');await wait('document.body.innerText.includes("Seguimiento de atención")');await wait('document.querySelector(".hw-inbox-detail textarea")!==null');
 await click('Guardar seguimiento');await wait('document.body.innerText.includes("Seguimiento guardado.")');await wait('Array.from(document.querySelectorAll("button")).some(x=>x.textContent.trim()==="Guardar seguimiento"&&!x.disabled)');await click('Guardar seguimiento');await wait(''+JSON.stringify(true));await sleep(500);assert.equal(bodies.length,2);assert.deepEqual(Object.keys(bodies[1]).sort(),['estado','notas','responsable','respuesta','revision']);
 meUnavailable=true;await navigate('/admin/dashboard?section=cotizaciones');await wait('document.body.innerText.includes("No pudimos validar tu sesión")');assert.ok(await evaluate('localStorage.getItem("horus-admin-token")'));meUnavailable=false;assert.equal(await evaluate('!!document.querySelector(".hp-shell")'),false);await click('Reintentar');await wait('document.body.innerText.includes("Cotizaciones")');
 await send('Network.enable');await send('Network.setCacheDisabled',{cacheDisabled:true});chunkError=true;await navigate('/admin/dashboard?section=cotizaciones');await wait('document.body.innerText.includes("No pudimos abrir esta página")');chunkError=false;await click('Recargar página');await wait('document.body.innerText.includes("Cotizaciones")');
 console.log('UI: carga de pantallas y recuperación de error comprobados.');
 console.log('UI: catálogo, detalle, consulta, FAQ/reintento, galería/foco, convenio, menú móvil, cotización, error de correo, seguimiento y sesión transitoria: OK.');
 const allowedHosts=['fonts.googleapis.com','fonts.gstatic.com','cdnjs.cloudflare.com','www.google.com'];
 const leaks=externalBlocked.filter(b=>{try{return b.method!=='GET'||!allowedHosts.includes(new URL(b.url).hostname)}catch{return true}});
 assert.equal(leaks.length,0,'Peticiones externas inesperadas: '+JSON.stringify(leaks.slice(0,3)));
 console.log('UI: '+externalBlocked.length+' peticiones públicas externas (fuentes, iconos, mapa) bloqueadas antes de enviarse; ninguna petición externa inesperada.');
 }finally{try{socket?.close()}catch{}cleanup?.()}}
main().catch(e=>{console.error(e.message);process.exitCode=1;server.close()});
