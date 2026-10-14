// Проекция 2:1. Масштаб 1 вписывает всю карту, включая прямоугольные миры.
export function minimapMatrix(map, width, height, zoom=1, focus=null) {
  const z=Math.max(1,Math.min(8,zoom||1));
  const k=Math.min((width-8)/(map.width+map.height),(height-8)*2/(map.width+map.height))*z;
  const center=z>1&&focus?focus:{x:map.width/2,y:map.height/2};
  return {a:k,b:k/2,c:-k,d:k/2,e:width/2-k*(center.x-center.y),f:height/2-k*(center.x+center.y)/2};
}
export function minimapWorldPoint(matrix,x,y) {
  const dx=x-matrix.e,dy=y-matrix.f,det=matrix.a*matrix.d-matrix.b*matrix.c;
  return {x:(matrix.d*dx-matrix.c*dy)/det,y:(matrix.a*dy-matrix.b*dx)/det};
}
