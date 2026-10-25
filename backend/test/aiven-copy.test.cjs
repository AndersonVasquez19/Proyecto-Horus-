const { test } = require('node:test');
const assert = require('node:assert/strict');
const { randomBytes } = require('node:crypto');
const lib = require('../scripts/aiven-copy-lib.cjs');
const { connectionOptions } = require('../scripts/aiven-copy.cjs');
const fixture = () => ({format:'horus-aiven/1',collation:'utf8mb4_unicode_ci',tables:['horus_migrations','rate_limit_buckets'].map(name=>({name,ddl:'CREATE TABLE `'+name+'` (`id` int NOT NULL, PRIMARY KEY (`id`)) ENGINE=InnoDB;',columns:[{name:'id',type:'int',extra:''}],pk:['id'],rows:[[1]]}))});
test('cifrado recuperable, clave incorrecta, alteración y hash no aprobado',()=>{
  const s=fixture(),key=randomBytes(32).toString('hex'), bytes=lib.seal(s,key), hash=lib.hash(bytes);
  assert.deepEqual(lib.unseal(bytes,key,hash),s);
  assert.equal(bytes.includes(Buffer.from('horus_migrations')),false);
  assert.throws(()=>lib.unseal(bytes,randomBytes(32).toString('hex'),hash));
  const changed=Buffer.from(bytes); changed[changed.length-1]^=1;
  assert.throws(()=>lib.unseal(changed,key,lib.hash(changed)));
  assert.throws(()=>lib.unseal(bytes,key,'0'.repeat(64)));
});
test('manifiesto incompleto, duplicado, SQL destructivo y referencia externa',()=>{
  let s=fixture();s.tables.push(s.tables[0]);assert.throws(()=>lib.validate(s));
  s=fixture();s.tables.pop();assert.throws(()=>lib.validate(s));
  for(const ddl of ['DROP TABLE `x`;','CREATE TABLE `horus_migrations` (`id` int); DROP TABLE `x`;','CREATE TABLE `horus_migrations` (`id` int, FOREIGN KEY (`id`) REFERENCES `otro`.`x` (`id`)) ENGINE=InnoDB;']) {
    s=fixture();s.tables[0].ddl=ddl;assert.throws(()=>lib.validate(s));
  }
});
test('comparación detecta valores con igual conteo, estructura y colación',()=>{
  const s=fixture(),other=fixture();other.tables[0].rows[0][0]=2;
  assert.deepEqual(lib.differences(s,other),['VALUES']);
  other.tables[0].ddl+=' ';other.collation='utf8mb4_0900_ai_ci';
  assert.ok(lib.differences(s,other).includes('STRUCTURE'));
  assert.ok(lib.differences(s,other).includes('DATABASE_COLLATION'));
});
test('capacidad deja margen y rechaza números inválidos',()=>{
  lib.capacity(fixture(),1e9,1e6);
  for(const used of [8e8,-1,NaN])assert.throws(()=>lib.capacity(fixture(),1e9,used));
});
test('configuración no hereda DB_* y rechaza host/cuenta/perfil',()=>{
  const c={profile:'fixture',fixture:true,host:'127.0.0.1',port:33060,database:'horus_copy_target',version:'8.4.11',user:'horus_migrator',password:'fictional',uuid:'11111111-1111-1111-1111-111111111111',noWriters:true,ca:'-----BEGIN CERTIFICATE-----'};
  const opts=connectionOptions(c);assert.equal(opts.ssl.verifyIdentity,true);assert.equal(opts.multipleStatements,false);
  for(const override of [{host:'example.com'},{port:3306},{user:'root'},{database:'horus_db'},{noWriters:false}]) assert.throws(()=>connectionOptions({...c,...override}));
});
test('normalización limitada de charset redundante conserva colaciones y literales',()=>{
  assert.equal(lib.comparableDdl('x CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci'), 'x COLLATE utf8mb4_unicode_ci');
  const literal="DEFAULT ' CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci'";
  assert.equal(lib.comparableDdl(literal),literal);
  assert.notEqual(lib.comparableDdl('x CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci'),lib.comparableDdl('x CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci'));
});
// ---- local-source: huella de la hoja + inspect (solo ficticios; nunca MySQL real) ----
const crypto=require('node:crypto'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),tls=require('node:tls');
const { spawnSync } = require('node:child_process');
const { pinnedIdentity, createVerifiedConnection, inspect, run } = require('../scripts/aiven-copy.cjs');
const UUID='22222222-2222-2222-2222-222222222222';
const FP='ab'.repeat(32);
const local=(extra={})=>({profile:'local-source',host:'127.0.0.1',port:3306,database:'horus_db',version:'8.0.46',user:'horus_migrator',password:'fictional-pass',uuid:UUID,ca:'-----BEGIN CERTIFICATE-----',tlsFingerprint256:FP,action:'inspect',...extra});
const GRANTS=['GRANT USAGE ON *.* TO `horus_migrator`@`localhost`','GRANT SELECT, INSERT, UPDATE, DELETE, CREATE, ALTER, INDEX, REFERENCES ON `horus_db`.* TO `horus_migrator`@`localhost`'];
function fakeDb(over={}){
  const s={uuid:UUID,version:'8.0.46',port:3306,db:'horus_db',account:'horus_migrator@localhost',
    tls:[{Variable_name:'Ssl_cipher',Value:'TLS_AES_256_GCM_SHA384'},{Variable_name:'Ssl_version',Value:'TLSv1.3'}],
    grants:GRANTS,objects:{VIEWS:0,TRIGGERS:0,ROUTINES:0,EVENTS:0},tables:Array.from({length:30},(_,i)=>({name:'t'+String(i+1).padStart(2,'0'),engine:'InnoDB'})),count:5,failCount:false,...over};
  const log=[];
  return {log,async query(sql){
    log.push(sql);
    if(/@@server_uuid/.test(sql))return [[{uuid:s.uuid,version:s.version,port:s.port,db:s.db,account:s.account}]];
    if(/SHOW SESSION STATUS/.test(sql))return [s.tls];
    if(/SHOW GRANTS/.test(sql))return [s.grants.map(g=>({'Grants for horus_migrator@localhost':g}))];
    if(/information_schema\.(VIEWS|TRIGGERS|ROUTINES|EVENTS)/.test(sql)){const k=/information_schema\.(\w+)/.exec(sql)[1];return [[{n:s.objects[k]}]];}
    if(/information_schema\.TABLES/.test(sql))return [s.tables];
    if(/^SELECT COUNT\(\*\) n FROM `/.test(sql)){if(s.failCount)throw new Error('SECRET-SQL-DETAIL');return [[{n:s.count}]];}
    if(/^(SET SESSION|START TRANSACTION|ROLLBACK)/.test(sql))return [[]];
    throw new Error('SQL inesperado: '+sql);
  }};
}
test('huella: acepta la hoja anclada y rechaza otra, vacía o mal formada',()=>{
  const raw=Buffer.from('certificado-ficticio'),good=crypto.createHash('sha256').update(raw).digest('hex');
  assert.equal(pinnedIdentity(good)('127.0.0.1',{raw}),undefined);
  assert.ok(pinnedIdentity(good)('127.0.0.1',{raw:Buffer.from('otro')}) instanceof Error);
  assert.ok(pinnedIdentity(good)('127.0.0.1',{}) instanceof Error);
  assert.ok(pinnedIdentity(good)('127.0.0.1',undefined) instanceof Error);
  for(const bad of [undefined,'',good.toUpperCase(),good.slice(2),'zz'.repeat(32)])assert.throws(()=>pinnedIdentity(bad));
});
test('huella: handshake TLS real contra servidor ficticio (CA verificada + pin)',async t=>{
  const found=['openssl','C:\\Program Files\\Git\\usr\\bin\\openssl.exe'].find(b=>{try{return spawnSync(b,['version']).status===0}catch{return false}});
  if(!found)return t.skip('openssl no disponible');
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'horus-tls-test-'));
  let server;
  try{
    const key=path.join(dir,'k.pem'),cert=path.join(dir,'c.pem');
    const gen=spawnSync(found,['req','-x509','-newkey','rsa:2048','-nodes','-keyout',key,'-out',cert,'-days','2','-subj','/CN=horus-fictional','-addext','basicConstraints=critical,CA:TRUE'],{stdio:'ignore'});
    assert.equal(gen.status,0);
    const pem=fs.readFileSync(cert,'utf8');
    const fp=new crypto.X509Certificate(pem).fingerprint256.replace(/:/g,'').toLowerCase();
    server=tls.createServer({key:fs.readFileSync(key),cert:pem,minVersion:'TLSv1.2'},s=>{s.on('error',()=>{});s.end();});
    await new Promise(r=>server.listen(0,'127.0.0.1',r));
    const connect=opts=>new Promise((resolve,reject)=>{const s=tls.connect({host:'127.0.0.1',port:server.address().port,minVersion:'TLSv1.2',...opts},()=>{s.destroy();resolve()});s.on('error',reject);});
    await connect({ca:pem,rejectUnauthorized:true,checkServerIdentity:pinnedIdentity(fp)});
    await assert.rejects(connect({ca:pem,rejectUnauthorized:true,checkServerIdentity:pinnedIdentity('cd'.repeat(32))}),/PIN/);
    // Sin la CA correcta la cadena no valida aunque la huella coincida: el pin no sustituye a la CA.
    await assert.rejects(connect({rejectUnauthorized:true,checkServerIdentity:pinnedIdentity(fp)}));
  }finally{
    if(server)await new Promise(r=>server.close(r));
    assert.equal(path.dirname(dir),os.tmpdir());assert.ok(path.basename(dir).startsWith('horus-tls-test-'));
    fs.rmSync(dir,{recursive:true,force:true});
  }
});
test('local-source exige huella válida, CA y no admite desactivar TLS',()=>{
  const opts=connectionOptions(local({noWriters:true,action:'backup'}));
  assert.equal(opts.ssl.rejectUnauthorized,true);assert.equal(opts.ssl.checkServerIdentity,undefined);
  assert.equal(opts.ssl.verifyIdentity,true);assert.equal(opts.multipleStatements,false);
  for(const override of [{tlsFingerprint256:undefined},{tlsFingerprint256:'AB'.repeat(32)},{tlsFingerprint256:'ab'},{ca:''},{host:'localhost'},{port:3307},{version:'8.4.11'},{user:'root'},{noWriters:false,action:'backup'}])assert.throws(()=>connectionOptions(local({noWriters:true,action:'backup',...override})),`override ${Object.keys(override)}`);
  const previous=process.env.NODE_TLS_REJECT_UNAUTHORIZED;process.env.NODE_TLS_REJECT_UNAUTHORIZED='0';
  try{assert.throws(()=>connectionOptions(local()))}finally{if(previous===undefined)delete process.env.NODE_TLS_REJECT_UNAUTHORIZED;else process.env.NODE_TLS_REJECT_UNAUTHORIZED=previous;}
});

// Servidor de protocolo ficticio: saludo MySQL -> SSLRequest -> TLS -> autenticación -> PING.
// No abre una base de datos ni usa credenciales/certificados de un entorno real.
test('mysql2 real: CA, hostname y pin del canal antes de enviar credenciales', {timeout:30000}, async t=>{
  const openssl=['openssl','C:\\Program Files\\Git\\usr\\bin\\openssl.exe'].find(b=>spawnSync(b,['version']).status===0);
  assert.ok(openssl,'openssl requerido para la regresión TLS');
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'horus-mysql2-tls-'));
  const root=path.dirname(require.resolve('mysql2'));
  const Handshake=require(path.join(root,'lib/packets/handshake.js'));
  const capabilities=require(path.join(root,'lib/constants/client.js'));
  const net=require('node:net');
  const makeCert=(name,san)=>{
    const key=path.join(dir,name+'.key'),cert=path.join(dir,name+'.pem');
    assert.equal(spawnSync(openssl,['req','-x509','-newkey','rsa:2048','-nodes','-keyout',key,'-out',cert,'-days','2','-subj','/CN=localhost','-addext','basicConstraints=critical,CA:TRUE','-addext','subjectAltName='+san],{stdio:'ignore'}).status,0);
    const pem=fs.readFileSync(cert,'utf8');
    return {key:fs.readFileSync(key),cert:pem,fp:crypto.createHash('sha256').update(new crypto.X509Certificate(pem).raw).digest('hex')};
  };
  try {
    const valid=makeCert('valid','IP:127.0.0.1');
    const wrongHost=makeCert('wrong-host','DNS:localhost');
    const other=makeCert('other','DNS:localhost,IP:127.0.0.1');
    const attempt=async(cert,over={},good=false,reason)=>{
      const sockets=new Set(),seen={accepted:0,ssl:0,tls:0,auth:0,commands:0};
      const server=net.createServer(socket=>{
        seen.accepted++;
        sockets.add(socket);socket.on('error',()=>{});socket.on('close',()=>sockets.delete(socket));
        const hello=new Handshake({protocolVersion:10,serverVersion:'8.4.11-fictional',connectionId:1,
          capabilityFlags:capabilities.LONG_PASSWORD|capabilities.PROTOCOL_41|capabilities.SECURE_CONNECTION|capabilities.PLUGIN_AUTH|capabilities.SSL,
          characterSet:45,statusFlags:2,authPluginData1:Buffer.alloc(8,1),authPluginData2:Buffer.alloc(12,2)}).toPacket(0);
        hello.writeHeader(0);socket.write(hello.buffer);
        let request=Buffer.alloc(0);
        const upgrade=chunk=>{
          request=Buffer.concat([request,chunk]);
          if(request.length<36)return;
          seen.ssl++;
          socket.pause();
          socket.removeListener('data',upgrade);
          if(request.readUIntLE(0,3)!==32){socket.destroy();return;}
          // SSLRequest y ClientHello pueden llegar juntos. Un Duplex conserva los bytes
          // ya leídos al cambiar de protocolo (TLSSocket sobre un handle TCP los perdería).
          const transport=new (require('node:stream').Duplex)({
            read(){socket.resume()},write(data,encoding,done){socket.write(data,encoding,done)},
            destroy(_error,done){socket.destroy();done()}
          });
          sockets.add(transport);transport.on('error',()=>{});transport.on('close',()=>sockets.delete(transport));
          socket.on('data',data=>transport.push(data));socket.on('end',()=>transport.push(null));
          const secure=new tls.TLSSocket(transport,{isServer:true,secureContext:tls.createSecureContext(cert),minVersion:'TLSv1.2'});
          secure.on('secure',()=>seen.tls++);
          sockets.add(secure);secure.on('error',()=>{});secure.on('close',()=>sockets.delete(secure));
          let pending=Buffer.alloc(0);
          secure.on('data',data=>{
            pending=Buffer.concat([pending,data]);
            while(pending.length>=4){
              const size=pending.readUIntLE(0,3)+4;if(pending.length<size)return;
              const packet=pending.subarray(0,size);pending=pending.subarray(size);
              if(!seen.auth){seen.auth++;secure.write(Buffer.from([7,0,0,3,0,0,0,2,0,0,0]));}
              else if(packet[4]===1){secure.end();}
              else{seen.commands++;secure.write(Buffer.from([7,0,0,1,0,0,0,2,0,0,0]));}
            }
          });
          if(request.length>36)transport.push(request.subarray(36));
          socket.resume();
        };
        socket.on('data',upgrade);
      });
      let db;
      try{
        await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve)});
        const config={profile:'fixture',fixture:true,action:'inspect',host:'127.0.0.1',port:server.address().port,
          database:'horus_copy_source',version:'8.4.11',uuid:UUID,user:'horus_migrator',password:'fictional-only',
          ca:valid.cert,tlsFingerprint256:valid.fp,...over};
        const connected=createVerifiedConnection(config);
        if(good){db=await connected;await db.ping();assert.equal(seen.auth,1);assert.equal(seen.commands,1);assert.equal(seen.tls,1);}
        else{await assert.rejects(connected,error=>error.code==='HANDSHAKE_SSL_ERROR'&&(!reason||reason.test(error.message)));assert.equal(seen.auth,0,'no transmitir autenticación antes de verificar TLS');assert.equal(seen.commands,0);}
      }finally{
        if(db)db.destroy();for(const s of sockets)s.destroy();
        await new Promise(resolve=>server.close(resolve));
      }
    };
    await t.test('acepta CA + hostname + pin correctos y permite PING',()=>attempt(valid,{},true));
    await t.test('rechaza pin incorrecto sin autenticar',()=>attempt(valid,{tlsFingerprint256:'cd'.repeat(32)},false,/^PIN$/));
    await t.test('rechaza CA incorrecta aunque coincida el pin',()=>attempt(valid,{ca:other.cert}));
    await t.test('rechaza hostname incorrecto aunque coincidan CA y pin',()=>attempt(wrongHost,{ca:wrongHost.cert,tlsFingerprint256:wrongHost.fp}));
    await t.test('rechaza otra hoja de confianza cuyo pin no coincide',()=>attempt(other,{ca:other.cert},false,/^PIN$/));
  }finally{
    // Solo el directorio temporal creado por esta prueba; nunca rutas derivadas de perfiles reales.
    assert.equal(path.dirname(dir),os.tmpdir());assert.ok(path.basename(dir).startsWith('horus-mysql2-tls-'));
    fs.rmSync(dir,{recursive:true,force:true});
  }
});

test('PowerShell: errores reales de JSON y HTTP quedan sanitizados sin ejecutar los scripts',()=>{
  const shell=process.platform==='win32'?'powershell.exe':'pwsh';
  for(const file of ['crear-horus-app-aiven.ps1','consultar-horus-app-aiven.ps1']){
    for(const scenario of ['json','json-valid','http','network']){
      // Se analiza el archivo, pero SOLO se ejecuta su catch exterior. No se ejecutan sus
      // prechequeos, Read-Host, HTTP, DPAPI, Node ni operaciones de disco.
      const script=path.resolve(__dirname,'../../docs/procedimientos',file).replace(/'/g,"''");
      const code=`
$ErrorActionPreference='Stop'
$tokens=$null;$errors=$null
$ast=[System.Management.Automation.Language.Parser]::ParseFile('${script}',[ref]$tokens,[ref]$errors)
if($errors.Count){exit 90}
$outer=@($ast.EndBlock.Statements | Where-Object { $_ -is [System.Management.Automation.Language.TryStatementAst] })[0]
$body=$outer.CatchClauses[0].Body.Extent.Text
$handler=[scriptblock]::Create($body.Substring(1,$body.Length-2))
$horusFase='respuesta-json';$horusStatus=201;$horusPostSent=$true;$horusSecretSaved=$false
try {
  if('${scenario}' -eq 'json') { '{"password":"FICTIONAL_PASSWORD_MARKER","token":"FICTIONAL_TOKEN_MARKER",broken}' | ConvertFrom-Json -ErrorAction Stop | Out-Null }
  elseif('${scenario}' -eq 'json-valid') {
    $response='{"user":{"password":"FICTIONAL_PASSWORD_MARKER"},"token":"FICTIONAL_TOKEN_MARKER"}' | ConvertFrom-Json -ErrorAction Stop
    throw (New-Object System.Exception($response.user.password))
  }
  else {
    $ex=New-Object System.Exception('FICTIONAL_PASSWORD_MARKER FICTIONAL_TOKEN_MARKER remote body')
    if('${scenario}' -eq 'http') {$ex | Add-Member -NotePropertyName Response -NotePropertyValue ([pscustomobject]@{StatusCode=403});$horusStatus=403}
    else {$horusStatus=0}
    throw $ex
  }
} catch { & $handler }
`;
      const result=spawnSync(shell,['-NoProfile','-NonInteractive','-Command',code],{encoding:'utf8',timeout:15000});
      assert.ifError(result.error);assert.equal(result.status,1,file+' '+scenario);
      const output=result.stdout+result.stderr;
      assert.match(output,/ERROR/);assert.match(output,/fase:/);
      assert.doesNotMatch(output,/FICTIONAL_PASSWORD_MARKER|FICTIONAL_TOKEN_MARKER|remote body|ConvertFrom-Json|Exception/);
      if(scenario==='http')assert.match(output,/HTTP 403/);
    }
  }
});

test('mysql2: una versión no auditada se rechaza antes de abrir sockets',async()=>{
  const vm=require('node:vm'),{createRequire}=require('node:module');
  const file=require.resolve('../scripts/aiven-copy.cjs'),realRequire=createRequire(file),sandboxModule={exports:{}};
  let opened=false;
  vm.runInNewContext(fs.readFileSync(file,'utf8'),{
    require:name=>name==='mysql2/package.json'?{version:'0.0.0'}:name==='mysql2'?{createConnection(){opened=true;throw Error('SOCKET')}}:realRequire(name),
    module:sandboxModule,Buffer,process,__dirname:path.dirname(file)
  },{filename:file});
  await assert.rejects(sandboxModule.exports.createVerifiedConnection(local()),/MYSQL2_TLS_VERSION/);
  assert.equal(opened,false);
});
test('inspect: solo local-source/fixture y sin exigir noWriters; el resto de acciones sí',()=>{
  assert.doesNotThrow(()=>connectionOptions(local()));
  assert.throws(()=>connectionOptions({...local(),profile:'aiven',host:'mysql-1b22a7e2-horus-group-dev.d.aivencloud.com',port:28816,service:'mysql-1b22a7e2',version:'8.4.11'}));
  assert.throws(()=>connectionOptions(local({action:'preflight'})));
});
test('inspect rechaza archivo, clave y opciones de respaldo antes de conectar',async()=>{
  for(const extra of [{file:'C:\\x\\a.bin'},{key:'a'.repeat(64)},{includeRateLimits:true}])await assert.rejects(run(local(extra)));
  await assert.rejects(run({...local(),profile:'aiven'}));
});
test('inspect correcto: informe agregado, solo lectura y sin datos sensibles',async()=>{
  const db=fakeDb(),r=await inspect(db,local());
  assert.equal(r.ok,true);assert.equal(r.tables,30);assert.equal(r.rows,150);assert.equal(Object.keys(r.counts).length,30);
  assert.deepEqual(r.objects,{views:0,triggers:0,routines:0,events:0});
  assert.deepEqual(Object.entries(r.checks).filter(([,v])=>!v),[]);
  assert.equal(r.tls.version,'TLSv1.3');
  const out=JSON.stringify(r);
  for(const secret of [UUID,'fictional-pass','horus_migrator@',FP,'localhost'])assert.equal(out.includes(secret),false,'filtra '+secret);
  assert.ok(db.log.every(q=>/^(SELECT|SHOW|SET SESSION|START TRANSACTION WITH CONSISTENT SNAPSHOT, READ ONLY$|ROLLBACK$)/.test(q)),'solo lectura');
  assert.equal(db.log.some(q=>/\b(INSERT|UPDATE|DELETE|CREATE|ALTER|DROP|TRUNCATE|GRANT|RENAME|LOCK)\b/i.test(q.replace(/^SHOW GRANTS$/,''))),false);
  assert.ok(db.log.includes('START TRANSACTION WITH CONSISTENT SNAPSHOT, READ ONLY'));
  assert.equal(db.log.at(-1),'ROLLBACK');
});
test('inspect marca cada desviación sin ocultarla',async()=>{
  const cases=[
    ['uuid',{uuid:'33333333-3333-3333-3333-333333333333'}],['version',{version:'8.4.11'}],['port',{port:3307}],['database',{db:'otra'}],['user',{account:'root@localhost'}],
    ['tls',{tls:[]}],['tls',{tls:[{Variable_name:'Ssl_cipher',Value:'X'},{Variable_name:'Ssl_version',Value:'TLSv1.1'}]}],
    ['noExtraObjects',{objects:{VIEWS:1,TRIGGERS:0,ROUTINES:0,EVENTS:0}}],['noExtraObjects',{objects:{VIEWS:0,TRIGGERS:0,ROUTINES:0,EVENTS:2}}],
    ['tableCount',{tables:Array.from({length:29},(_,i)=>({name:'t'+i,engine:'InnoDB'}))}],['innodb',{tables:Array.from({length:30},(_,i)=>({name:'t'+i,engine:i?'InnoDB':'MyISAM'}))}],
    ['grantsScope',{grants:[GRANTS[0],GRANTS[1]+' WITH GRANT OPTION']}],['grantsScope',{grants:[GRANTS[0],'GRANT SELECT ON `otra`.* TO `horus_migrator`@`localhost`']}],
    ['grantsExact',{grants:[GRANTS[0],'GRANT SELECT, INSERT ON `horus_db`.* TO `horus_migrator`@`localhost`']}],
    ['selectGranted',{grants:[GRANTS[0],'GRANT INSERT ON `horus_db`.* TO `horus_migrator`@`localhost`']}],
  ];
  for(const [check,over] of cases){const db=fakeDb(over),r=await inspect(db,local());assert.equal(r.ok,false,check);assert.equal(r.checks[check],false,check);assert.equal(db.log.at(-1),'ROLLBACK');}
  assert.equal((await inspect(fakeDb(),local({expectedRows:150}))).checks.expectedRows,true);
  assert.equal((await inspect(fakeDb({count:4}),local({expectedRows:150}))).ok,false);
});
test('inspect cierra la transacción con ROLLBACK si falla un recuento',async()=>{
  const db=fakeDb({failCount:true});
  await assert.rejects(inspect(db,local()),e=>true);
  assert.equal(db.log.at(-1),'ROLLBACK');
});
test('importar comprobador de esquema no carga conexión, dotenv ni Prisma',()=>{
  const {spawnSync}=require('node:child_process');
  const file=require.resolve('../scripts/check-database.cjs');
  const code="const Module=require('node:module');const original=Module._load;Module._load=function(name,...args){if(/dotenv|@prisma/.test(name)||name==='./database.cjs')throw Error('CONFIG_LOAD');return original.call(this,name,...args)};require("+JSON.stringify(file)+");";
  assert.equal(spawnSync(process.execPath,['-e',code],{encoding:'utf8'}).status,0);
});
