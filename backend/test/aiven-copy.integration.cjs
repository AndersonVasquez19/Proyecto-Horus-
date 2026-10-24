// Crea SOLO un contenedor propio con tmpfs y bases ficticias; nunca usa DB_* heredadas.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { randomBytes } = require('node:crypto');
const mysql = require('mysql2/promise');
const lib = require('../scripts/aiven-copy-lib.cjs');
const { run, connectionOptions } = require('../scripts/aiven-copy.cjs');
const IMAGE='mysql@sha256:0744ee5ef89ce6ccfa13de3e579fe6b9e27f93dd70da9c06d2c908b1b193fb8d';
const docker=(args)=>{const r=spawnSync('docker',args,{encoding:'utf8',timeout:120000});if(r.status!==0)throw new Error('DOCKER_FIXTURE');return r.stdout.trim();};
test('copia cifrada completa MySQL 8.4.11, permisos mínimos y rechazos', {timeout:240000}, async t=>{
  const name='horus-copy-'+randomBytes(5).toString('hex');
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'horus-copy-'));
  const password=randomBytes(24).toString('hex'),key=randomBytes(32).toString('hex');
  let admin,owned=false;
  try {
    docker(['run','-d','--name',name,'--label','horus.fixture=aiven-copy','--tmpfs','/var/lib/mysql:rw','-p','127.0.0.1::3306','-e','MYSQL_ALLOW_EMPTY_PASSWORD=yes','-e','MYSQL_ROOT_HOST=%',IMAGE,'sh','-c',
      'mkdir -p /tmp/tls && openssl req -x509 -newkey rsa:2048 -nodes -keyout /tmp/tls/key.pem -out /tmp/tls/cert.pem -days 1 -subj /CN=localhost -addext subjectAltName=IP:127.0.0.1,DNS:localhost >/dev/null 2>&1 && chown -R mysql:mysql /tmp/tls && exec docker-entrypoint.sh mysqld --ssl-ca=/tmp/tls/cert.pem --ssl-cert=/tmp/tls/cert.pem --ssl-key=/tmp/tls/key.pem']);
    owned=true;
    const port=Number(docker(['port',name,'3306/tcp']).split(':').pop());
    for(let i=0;i<60;i++) {
      try {admin=await mysql.createConnection({host:'127.0.0.1',port,user:'root',password:'',ssl:{rejectUnauthorized:false}});break;}
      catch{await new Promise(r=>setTimeout(r,1000));}
    }
    assert.ok(admin,'servidor ficticio disponible');
    const [[v]]=await admin.query('SELECT VERSION() version, @@server_uuid uuid');assert.equal(v.version,'8.4.11');
    const ca=docker(['exec',name,'cat','/tmp/tls/cert.pem']);
    const base={profile:'fixture',fixture:true,host:'127.0.0.1',port,user:'horus_migrator',password,ca,uuid:v.uuid,version:'8.4.11',noWriters:true,key,file:path.join(dir,'copy.horus'),quotaBytes:1e9,usedBytes:0};
    for(const database of ['horus_copy_source','horus_copy_target','horus_copy_bad'])await admin.query('CREATE DATABASE `'+database+'` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci');
    // Usuarios separados por host para que SHOW GRANTS no incluya otras bases.
    await admin.query('CREATE USER ?@? IDENTIFIED BY ?',['horus_migrator','%',password]);
    await admin.query('GRANT SELECT,INSERT,UPDATE,DELETE,CREATE,ALTER,INDEX,REFERENCES ON horus_copy_source.* TO ?@?',['horus_migrator','%']);
    const cleanEnv={PATH:process.env.PATH,SystemRoot:process.env.SystemRoot,TEMP:dir,TMP:dir,DB_HOST:'127.0.0.1',DB_PORT:String(port),DB_USER:'root',DB_PASS:'',DB_NAME:'horus_copy_source',DB_SSL:'true',DB_SSL_CA:ca};
    const script=(file)=>spawnSync(process.execPath,['-r',path.join(__dirname,'isolate-env.cjs'),path.join(__dirname,'../scripts',file)],{cwd:dir,env:cleanEnv,encoding:'utf8',timeout:60000});
    for(const file of ['init-database.cjs','migrate.cjs']) {const r=script(file);assert.equal(r.status,0,'preparación ficticia: '+file);}
    await admin.query('USE horus_copy_source');
    const bcrypt=require('bcryptjs').hashSync('Ficticia-No-Real-2026',8);
    await admin.execute("INSERT INTO admin_users (nombre,email,password,rol,createdAt,updatedAt) VALUES ('Ensayo','fixture@example.invalid',?,'GERENTE_GENERAL','2026-10-24 00:00:00','2026-10-24 00:00:00')",[bcrypt]);
    await admin.query("INSERT INTO rate_limit_buckets (id,count,expiresAt) VALUES ('fixture',2,'2026-10-24 12:00:00')");
    await admin.query("INSERT INTO cursos (titulo,slug,descripcion,tipo,modalidad,duracion,estado,createdAt,updatedAt) VALUES ('Curso ficticio','fixture','Tildes áéí; comillas y unicode 漢字','curso','virtual','40 horas','publicado',NOW(),NOW())");
    await admin.query("INSERT INTO convocatorias (curso_id,nombre) VALUES (1,'Edición ficticia')");
    await admin.query("INSERT INTO estudiantes (nombres,apellidos,doc_pais,doc_tipo,doc_numero) VALUES ('Ficticio','Ensayo','PE','DNI','00012345')");
    await admin.query('INSERT INTO matriculas (estudiante_id,convocatoria_id) VALUES (1,1)');
    await admin.query("INSERT INTO certificados (matricula_id,codigo_verificacion,estudiante_nombres,estudiante_apellidos,estudiante_doc_pais,estudiante_doc_tipo,estudiante_doc_numero,curso_titulo,curso_tipo,convocatoria_nombre,emitido_por) VALUES (1,'11111111111111111111111111111111','Ficticio','Ensayo','PE','DNI','00012345','Curso ficticio','curso','Edición ficticia',1)");
    await admin.query("INSERT INTO docentes (nombres,apellidos) VALUES ('Ficticio','Histórico')");
    await admin.query('INSERT INTO docente_asignaciones (docente_id,convocatoria_id) VALUES (1,1)');
    await admin.query("INSERT INTO convocatoria_horarios (convocatoria_id,dia_semana,hora_inicio,hora_fin) VALUES (1,1,'09:30:00','11:00:00')");
    const source={...base,database:'horus_copy_source'};
    const backup=await run({...source,action:'backup',includeRateLimits:true});
    assert.equal(backup.tables,30);
    const cfg={...base,sha256:backup.sha256,database:'horus_copy_target'};
    assert.equal((await run({...cfg,action:'verify'})).verified,true);
    const second=path.join(dir,'second.horus');fs.copyFileSync(base.file,second,fs.constants.COPYFILE_EXCL);
    assert.equal(lib.hash(fs.readFileSync(second)),backup.sha256);
    // Cambiar permisos solo en la cuenta ficticia del servidor recién creado.
    await admin.query('REVOKE ALL PRIVILEGES ON horus_copy_source.* FROM ?@?',['horus_migrator','%']);
    await admin.query('GRANT SELECT,INSERT,UPDATE,DELETE,CREATE,ALTER,INDEX,REFERENCES ON horus_copy_target.* TO ?@?',['horus_migrator','%']);
    await assert.rejects(run({...cfg,action:'preflight',uuid:'00000000-0000-0000-0000-000000000000'}));
    await assert.rejects(run({...cfg,action:'preflight',ca:'invalid'}));
    assert.equal((await run({...cfg,action:'preflight'})).empty,true);
    let result;
    try { result=await run({...cfg,action:'apply',approval:'IMPORT_EMPTY_DATABASE'}); }
    catch(error) {
      const diagnostic=await mysql.createConnection(connectionOptions(cfg));
      try {
        const expected=lib.unseal(fs.readFileSync(base.file),key,backup.sha256),actual=await lib.capture(diagnostic);
        for(const table of expected.tables) {
          const got=actual.tables.find(v=>v.name===table.name);
          if(got&&JSON.stringify(table)!==JSON.stringify(got))t.diagnostic(JSON.stringify({table:table.name,ddl:table.ddl===got.ddl,columns:JSON.stringify(table.columns)===JSON.stringify(got.columns),rows:JSON.stringify(table.rows)===JSON.stringify(got.rows)}));
          if(got&&table.name==='horus_migrations')t.diagnostic(JSON.stringify({expectedDdl:table.ddl,actualDdl:got.ddl}));
        }
      } finally {await diagnostic.end();}
      throw error;
    }
    assert.equal(result.tables,30);
    assert.equal((await run({...cfg,action:'compare'})).equal,true);
    await assert.rejects(run({...cfg,action:'apply',approval:'IMPORT_EMPTY_DATABASE'}));
    cleanEnv.DB_NAME='horus_copy_target';const check=script('check-database.cjs');assert.equal(check.status,0,'db:check del destino');
    const prismaCode="const {prisma}=require("+JSON.stringify(path.join(__dirname,'../scripts/database.cjs'))+"); const db=prisma(); (async()=>{if(await db.adminUser.count()!==1||await db.certificado.count()!==1||await db.docente.count()!==1)throw Error('counts'); await db.$disconnect();})().catch(()=>{process.exitCode=1});";
    const prisma=spawnSync(process.execPath,['-r',path.join(__dirname,'isolate-env.cjs'),'-e',prismaCode],{cwd:dir,env:cleanEnv,encoding:'utf8',timeout:30000});
    assert.equal(prisma.status,0,'Prisma: lectura de cuenta y tablas históricas');
    const db=await mysql.createConnection(connectionOptions(cfg));
    try {
      const [[m]]=await db.query('SELECT COUNT(*) n FROM horus_migrations');assert.equal(Number(m.n),18);
      await assert.rejects(db.query('DROP TABLE rate_limit_buckets'));
      const tls=require('node:tls');
      assert.ok(tls.checkServerIdentity('wrong.example.invalid',db.connection.stream.getPeerCertificate()),'hostname distinto rechazado');
      // Alteración autorizada exclusivamente del fixture: el mismo recuento debe fallar.
      await db.query("UPDATE admin_users SET password='fixture-changed' WHERE email='fixture@example.invalid'");
      await assert.rejects(run({...cfg,action:'compare'}));
      await db.query('SET SESSION foreign_key_checks=0');
      await db.query('UPDATE matriculas SET estudiante_id=999 WHERE id=1');
      await db.query('SET SESSION foreign_key_checks=1');
      await assert.rejects(lib.capture(db),/ORPHANS/);
    } finally {await db.end();}
    // CLI: errores no muestran secreto, SQL, filas ni stack.
    const cli=spawnSync(process.execPath,[path.join(__dirname,'../scripts/aiven-copy.cjs')],{input:JSON.stringify({...cfg,action:'compare'}),encoding:'utf8',cwd:dir});
    assert.equal(cli.status,1);for(const secret of [password,key,bcrypt,'fixture@example.invalid'])assert.equal((cli.stdout+cli.stderr).includes(secret),false);
    assert.deepEqual(fs.readdirSync(dir).sort(),['copy.horus','second.horus']);
    await admin.query('REVOKE ALL PRIVILEGES ON horus_copy_target.* FROM ?@?',['horus_migrator','%']);
    await admin.query('GRANT SELECT,INSERT,UPDATE,DELETE,CREATE,ALTER,INDEX,REFERENCES ON horus_copy_bad.* TO ?@?',['horus_migrator','%']);
    const bad=await mysql.createConnection(connectionOptions({...cfg,database:'horus_copy_bad'}));
    try {
      const snapshot=lib.unseal(fs.readFileSync(base.file),key,backup.sha256);
      let writes=0;
      const fault={query:bad.query.bind(bad),execute:async()=>{writes++;throw Error('FICTIONAL_DISCONNECT');}};
      await assert.rejects(lib.apply(fault,snapshot),/FICTIONAL_DISCONNECT/);
      assert.equal(writes,1,'sin reintentos de INSERT');
      const [tables]=await bad.query('SHOW TABLES');assert.equal(tables.length,30,'DDL parcial conservado');
      const [[fk]]=await bad.query('SELECT @@SESSION.foreign_key_checks n');assert.equal(Number(fk.n),1);
      await assert.rejects(lib.apply(bad,snapshot),/NOT_EMPTY/);
    } finally {await bad.end();}
    t.diagnostic('MySQL '+v.version+'; 30 tablas; 18 migraciones; cifrado, importación, comparación, db:check y rechazos correctos.');
  } finally {
    if(admin)await admin.end().catch(()=>{});
    if(owned)docker(['rm','-f',name]);
    // Directorio exclusivo creado por esta prueba; solo contiene datos ficticios cifrados.
    fs.rmSync(dir,{recursive:true,force:true});
  }
});
