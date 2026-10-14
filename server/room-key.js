'use strict';
const Regions=require('../shared/regions');
const LOCAL=/^(?:[a-z]{1,2}\d{1,3}\.\d|h\d{1,7}\.-?\d)$/;
function level(key){if(typeof key!=='string')return false;if(LOCAL.test(key))return true;const p=Regions.parse(key);return Boolean(p&&key.startsWith('region_')&&(!p.local||LOCAL.test(p.local)));}
function room(id){if(typeof id!=='string')return false;const [world,key,...rest]=id.split('~');return !rest.length&&/^[0-9a-f-]{36}$/.test(world)&&(key===undefined||level(key));}
module.exports={level,room};
