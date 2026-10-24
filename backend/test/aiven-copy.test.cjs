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
test('importar comprobador de esquema no carga conexión, dotenv ni Prisma',()=>{
  const {spawnSync}=require('node:child_process');
  const file=require.resolve('../scripts/check-database.cjs');
  const code="const Module=require('node:module');const original=Module._load;Module._load=function(name,...args){if(/dotenv|@prisma/.test(name)||name==='./database.cjs')throw Error('CONFIG_LOAD');return original.call(this,name,...args)};require("+JSON.stringify(file)+");";
  assert.equal(spawnSync(process.execPath,['-e',code],{encoding:'utf8'}).status,0);
});
