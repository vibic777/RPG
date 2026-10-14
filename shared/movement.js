// Передвижение: поиск пути A*, шаг с учётом препятствий, проверка позиции.
// Общий код: клиент предсказывает движение героя, сервер двигает героя по тем же правилам и проверяет каждый шаг.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./worldgen'));
  else root.Movement = factory(root.WorldGen);
})(typeof self !== 'undefined' ? self : this, function (WorldGen) {
  'use strict';

  const settings = {
    actorRadius: .22,
    heroSpeed: 4, // клеток в секунду по ровной местности
    pathMaxNodes: 60000, // предел раскрытых узлов A* (защита от зависаний на огромных картах)
    moveTolerance: 1.5, // допуск сервера к скорости
    maxPathLength: 5000, // предел длины пути, присланного клиентом, клеток
    swimSpeed: 0.45, // скорость вплавь (шаг 13), доля от heroSpeed
  };
  function configure(o = {}) {
    for (const k of Object.keys(settings)) if (Number.isFinite(o[k])) settings[k] = o[k];
  }

  // Скорость на клетке (доля от heroSpeed): вплавь (world.swimmer, шаг 13) — swimSpeed
  const tileSpeed = (world, t) => { if (world.drive) return world.drive.speed(t); const b = WorldGen.BIOMES[t]; return b.swim && world.swimmer ? settings.swimSpeed : b.speed || 0; };
  const isSwimming = (world, x, y) => !world.flyer && !world.drive && Boolean(WorldGen.BIOMES[WorldGen.tileAt(world, Math.floor(x), Math.floor(y))].swim || world.blocks?.get(Math.floor(y)*world.width+Math.floor(x))?.block==='moat');

  const SQRT2 = Math.SQRT2;
  const DIRS = [[1, 0, 1], [-1, 0, 1], [0, 1, 1], [0, -1, 1], [1, 1, SQRT2], [1, -1, SQRT2], [-1, 1, SQRT2], [-1, -1, SQRT2]];

  // Сетка для A*: { width, height, walkable(x,y), cost(x,y) } — cost ≥ 1 (1 / скорость биома)
  function gridFromWorld(world) {
    const { BIOMES } = WorldGen;
    return {
      width: world.width,
      height: world.height,
      walkable: (x, y) => cellWalkable(world, x, y),
      cost: (x, y) => (world.flyer && !world.drive ? 1 : 1 / tileSpeed(world, WorldGen.tileAt(world, x, y))),
      region: world.region ? (x, y) => (world.flyer || world.swimmer || world.drive ? 0 : world.region[y * world.width + x]) : null, // летуну и пловцу острова не преграда
    };
  }

  // Двоичная куча по приоритету
  class Heap {
    constructor() { this.items = []; this.prio = []; }
    get size() { return this.items.length; }
    push(item, p) {
      const a = this.items, q = this.prio;
      let i = a.length; a.push(item); q.push(p);
      while (i > 0) {
        const parent = (i - 1) >> 1;
        if (q[parent] <= p) break;
        a[i] = a[parent]; q[i] = q[parent]; i = parent;
      }
      a[i] = item; q[i] = p;
    }
    pop() {
      const a = this.items, q = this.prio;
      const top = a[0];
      const last = a.pop(), lastP = q.pop();
      if (a.length) {
        let i = 0;
        const n = a.length;
        for (;;) {
          let c = 2 * i + 1;
          if (c >= n) break;
          if (c + 1 < n && q[c + 1] < q[c]) c++;
          if (q[c] >= lastP) break;
          a[i] = a[c]; q[i] = q[c]; i = c;
        }
        a[i] = last; q[i] = lastP;
      }
      return top;
    }
  }

  const cache = new WeakMap(); // буферы A* на сетку

  // Возвращает массив клеток [[x,y], ...] от старта (не включая) до цели или null
  function findPath(grid, sx, sy, tx, ty, maxNodes = settings.pathMaxNodes) {
    const W = grid.width, H = grid.height;
    const inside = (x, y) => x >= 0 && y >= 0 && x < W && y < H;
    if (!inside(sx, sy) || !inside(tx, ty) || !grid.walkable(tx, ty)) return null;
    if (sx === tx && sy === ty) return [];
    if (grid.region && grid.region(sx, sy) !== grid.region(tx, ty) && grid.walkable(sx, sy)) return null; // разные «острова»

    let buf = cache.get(grid);
    if (!buf || buf.n !== W * H) {
      buf = { n: W * H, g: new Float32Array(W * H), parent: new Int32Array(W * H), stamp: new Uint32Array(W * H), closed: new Uint32Array(W * H), run: 0 };
      cache.set(grid, buf);
    }
    const run = ++buf.run;
    const { g, parent, stamp, closed } = buf;
    const h = (x, y) => { const dx = Math.abs(x - tx), dy = Math.abs(y - ty); return (dx + dy) + (SQRT2 - 2) * Math.min(dx, dy); };
    const start = sy * W + sx, goal = ty * W + tx;
    const open = new Heap();
    g[start] = 0; stamp[start] = run; parent[start] = -1;
    open.push(start, h(sx, sy));
    let expanded = 0;
    while (open.size) {
      const cur = open.pop();
      if (closed[cur] === run) continue;
      closed[cur] = run;
      if (cur === goal) break;
      if (++expanded > maxNodes) return null;
      const cx = cur % W, cy = (cur / W) | 0;
      for (const [dx, dy, len] of DIRS) {
        const nx = cx + dx, ny = cy + dy;
        if (!inside(nx, ny) || !grid.walkable(nx, ny)) continue;
        if (dx && dy && (!grid.walkable(cx + dx, cy) || !grid.walkable(cx, cy + dy))) continue; // не срезаем углы
        const ni = ny * W + nx;
        if (closed[ni] === run) continue;
        const ng = g[cur] + len * grid.cost(nx, ny);
        if (stamp[ni] !== run || ng < g[ni]) {
          stamp[ni] = run; g[ni] = ng; parent[ni] = cur;
          open.push(ni, ng + h(nx, ny));
        }
      }
    }
    if (closed[goal] !== run) return null;
    const path = [];
    for (let i = goal; i !== start; i = parent[i]) path.push([i % W, (i / W) | 0]);
    return path.reverse();
  }

  // ---------- Непрерывное движение (позиция — дробные координаты клеток, центр клетки = x + 0.5) ----------
  function footprintWalkable(world,x,y,radius,planning=false,heading=world.drive?.heading||0){
    if(!WorldGen.isWalkable(world,Math.floor(x),Math.floor(y)))return false;
    if(world.drive?.bodyAt&&!planning){
      const body=world.drive.bodyAt(x,y,heading);
      for(let cy=Math.floor(y-body.extentY-1);cy<=Math.floor(y+body.extentY+1);cy++)for(let cx=Math.floor(x-body.extentX-1);cx<=Math.floor(x+body.extentX+1);cx++){
        if(!WorldGen.isWalkable(world,cx,cy)&&world.drive.intersectsCell(body,cx,cy))return false;
      }return true;
    }
    radius=Math.max(0,radius||0);if(!radius)return true;
    for(let cy=Math.floor(y-radius);cy<=Math.floor(y+radius);cy++)for(let cx=Math.floor(x-radius);cx<=Math.floor(x+radius);cx++){
      const dx=Math.max(0,Math.abs(cx+.5-x)-.5),dy=Math.max(0,Math.abs(cy+.5-y)-.5);
      if(dx*dx+dy*dy<radius*radius-1e-8&&!WorldGen.isWalkable(world,cx,cy))return false;
    }return true;
  }
  const actorRadius=world=>world.actorRadius??settings.actorRadius;
  const cellWalkable=(world,x,y)=>footprintWalkable(world,x+.5,y+.5,world.drive?.planRadius??world.drive?.radius??actorRadius(world),true);
  const posWalkable=(world,x,y)=>footprintWalkable(world,x,y,world.drive?.radius??actorRadius(world));
  function blockedFootprintCells(world,x,y,heading){
    const body=world.drive?.bodyAt?.(x,y,heading),radius=actorRadius(world),blocked=new Map();
    const ex=body?.extentX??radius,ey=body?.extentY??radius;
    for(let cy=Math.floor(y-ey-1);cy<=Math.floor(y+ey+1);cy++)for(let cx=Math.floor(x-ex-1);cx<=Math.floor(x+ex+1);cx++){
      const dx=Math.max(0,Math.abs(cx+.5-x)-.5),dy=Math.max(0,Math.abs(cy+.5-y)-.5);
      const intersects=body?world.drive.intersectsCell(body,cx,cy):dx*dx+dy*dy<radius*radius-1e-8;
      if(intersects&&!WorldGen.isWalkable(world,cx,cy))blocked.set(`${cx},${cy}`,body?(world.drive.cellOverlap?.(body,cx,cy)??1):Math.max(0,radius-Math.hypot(dx,dy)));
    }
    return blocked;
  }
  function segmentWalkable(world,from,dx,dy){
    const distance=Math.hypot(dx,dy),oldAngle=world.drive?.heading||0,newAngle=world.drive?.motionHeading?world.drive.motionHeading(oldAngle,dx,dy):distance>.0001?Math.atan2(dy,dx):oldAngle;
    const turn=Math.atan2(Math.sin(newAngle-oldAngle),Math.cos(newAngle-oldAngle));
    const steps=Math.max(1,Math.ceil((distance+Math.abs(turn)*(world.drive?.radius||0))/.12));
    // Old saves may contain an embedded hull. Escape may touch its existing obstacle,
    // but must never cross a new wall on the way to a clear destination.
    const embedded=!posWalkable(world,from.x,from.y);
    if(embedded){
      if(!world.drive?.cellOverlap&&!footprintWalkable(world,from.x+dx,from.y+dy,world.drive?.radius??actorRadius(world),false,newAngle))return false;
      const initial=blockedFootprintCells(world,from.x,from.y,oldAngle);
      const sum=cells=>[...cells.values()].reduce((total,area)=>total+area,0),startArea=sum(initial);
      let previousArea=startArea;
      for(let i=1;i<=steps;i++){
        const t=i/steps,cells=blockedFootprintCells(world,from.x+dx*t,from.y+dy*t,oldAngle+turn*t),area=sum(cells);
        for(const cell of cells.keys())if(!initial.has(cell))return false;
        if(world.drive?.cellOverlap&&area>previousArea+1e-8)return false;
        previousArea=area;
      }
      return !world.drive?.cellOverlap||previousArea<startArea-1e-8;
    }
    for(let i=1;i<=steps;i++){const t=i/steps;if(!footprintWalkable(world,from.x+dx*t,from.y+dy*t,world.drive?.radius??actorRadius(world),false,oldAngle+turn*t))return false;}
    return true;
  }
  // mul — множитель скорости (бег, замедление, враги со своей скоростью)
  const speedAt = (world, x, y, mul = 1) => settings.heroSpeed * mul * (world.blocks?.get(Math.floor(y)*world.width+Math.floor(x))?.block==='moat'&&!world.flyer&&!world.drive?settings.swimSpeed:1) * (world.flyer && !world.drive ? 1 : tileSpeed(world, WorldGen.tileAt(world, Math.floor(x), Math.floor(y))));

  // Сдвиг с «скольжением» вдоль препятствий. Возвращает новую позицию.
  function moveWithCollision(world,pos,dx,dy){
    for(const [sx,sy] of [[dx,dy],[dx,0],[0,dy]]){
      if(!sx&&!sy)continue;
      if(segmentWalkable(world,pos,sx,sy)){if(world.drive)world.drive.heading=world.drive.motionHeading?world.drive.motionHeading(world.drive.heading||0,sx,sy):Math.atan2(sy,sx);return{x:pos.x+sx,y:pos.y+sy};}
    }return{x:pos.x,y:pos.y};
  }

  // Продвижение по пути за dt секунд. path — массив клеток; возвращает { pos, path }
  function followPath(world, pos, path, dt, mul = 1) {
    let budget = speedAt(world, pos.x, pos.y, mul) * dt;
    let p = { x: pos.x, y: pos.y };
    const rest = path.slice();
    while (rest.length && budget > 0) {
      const tx = rest[0][0] + 0.5, ty = rest[0][1] + 0.5;
      const dx = tx - p.x, dy = ty - p.y;
      const dist = Math.hypot(dx, dy);
      if (dist < 1e-5) { rest.shift(); continue; }
      const step = Math.min(dist, budget), moved = moveWithCollision(world, p, (dx / dist) * step, (dy / dist) * step);
      if (Math.hypot(moved.x - p.x, moved.y - p.y) < 1e-5) break;
      p = moved; budget -= step;
      if (Math.hypot(tx - p.x, ty - p.y) < 1e-4) rest.shift();
    }
    return { pos: p, path: rest };
  }

  // Проверка позиции (сервер): в пределах карты и на проходимой клетке
  function validatePosition(world, pos, allowBlocked = false) {
    if (!pos || !Number.isFinite(pos.x) || !Number.isFinite(pos.y)) return 'Некорректные координаты.';
    if (pos.x < 0 || pos.y < 0 || pos.x >= world.width || pos.y >= world.height) return 'Позиция вне карты.';
    if (!allowBlocked && !posWalkable(world, pos.x, pos.y)) return 'Позиция на непроходимой клетке.';
    if (pos.z !== undefined && !(Number.isInteger(pos.z) && pos.z >= -5 && pos.z <= 10)) return 'Уровень вне диапазона −5…+10.';
    return null;
  }

  // Проверка пути, присланного клиентом: клетки подряд (соседние по 8 направлениям), все проходимы,
  // без срезания углов препятствий. Первая клетка — соседняя с клеткой from (или та же).
  function validatePath(world, from, path, maxLen = settings.maxPathLength) {
    if (!Array.isArray(path) || !path.length) return 'Пустой путь.';
    if (path.length > maxLen) return 'Слишком длинный путь.';
    const walk = (x, y) => cellWalkable(world, x, y);
    let cx = Math.floor(from.x), cy = Math.floor(from.y);
    for (const c of path) {
      if (!Array.isArray(c) || c.length !== 2 || !Number.isInteger(c[0]) || !Number.isInteger(c[1])) return 'Некорректная клетка пути.';
      const [x, y] = c;
      const dx = x - cx, dy = y - cy;
      if (Math.abs(dx) > 1 || Math.abs(dy) > 1) return 'Разрыв пути: шаг длиннее одной клетки.';
      if (x < 0 || y < 0 || x >= world.width || y >= world.height) return 'Путь выходит за край карты.';
      if (!walk(x, y)) return 'Путь проходит через непроходимую клетку.';
      if (dx && dy && (!walk(cx + dx, cy) || !walk(cx, cy + dy))) return 'Путь срезает угол препятствия.';
      cx = x; cy = y;
    }
    return null;
  }

  // Same ice inertia on the server and in client prediction. Collision always applies.
  function surfaceMove(world,from,intended,state,dt,onIce,maxSpeed=Infinity) {
    if(!(dt>0))return intended;
    const vx=(intended.x-from.x)/dt,vy=(intended.y-from.y)/dt;
    if(!onIce){state.vx=vx;state.vy=vy;return intended;}
    const blend=1-Math.exp(-dt/0.32);
    state.vx=(state.vx||0)+(vx-(state.vx||0))*blend;state.vy=(state.vy||0)+(vy-(state.vy||0))*blend;
    const length=Math.hypot(state.vx,state.vy);if(length>maxSpeed){state.vx*=maxSpeed/length;state.vy*=maxSpeed/length;}
    if(Math.hypot(state.vx,state.vy)<0.025){state.vx=state.vy=0;}
    const to=moveWithCollision(world,from,state.vx*dt,state.vy*dt);
    if(Math.abs(to.x-from.x)<Math.abs(state.vx*dt)*0.3)state.vx=0;
    if(Math.abs(to.y-from.y)<Math.abs(state.vy*dt)*0.3)state.vy=0;
    return to;
  }

  // Проверка шага (сервер, каждый тик): не быстрее допустимого и без прохода сквозь препятствия
  function validateStep(world, from, to, dt, mul = 1) {
    const err = validatePosition(world, to, Boolean(world.drive?.cellOverlap));
    if (err) return err;
    const maxDist = settings.heroSpeed * Math.max(1, mul) * 1.1 * dt * settings.moveTolerance + 0.05;
    if(!segmentWalkable(world,from,to.x-from.x,to.y-from.y))return 'Перемещение проходит через препятствие.';
    if (Math.hypot(to.x - from.x, to.y - from.y) > maxDist) return 'Слишком быстрое перемещение.';
    return null;
  }

  return { settings, configure, segmentWalkable,gridFromWorld, findPath, moveWithCollision, followPath, surfaceMove, speedAt, tileSpeed, isSwimming, posWalkable, validatePosition, validateStep, validatePath, Heap };
});
