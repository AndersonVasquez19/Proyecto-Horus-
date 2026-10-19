// Estado del mapa de ubicación. Sin sondeos ni temporizadores: el iframe de Google Maps solo existe tras una acción explícita
// de la persona, y `navigator.onLine` se usa únicamente para NO iniciar una petición cuando el navegador está claramente
// sin red (nunca como garantía de que el mapa vaya a cargar).
export type MapView = 'card' | 'map'
export type MapNotice = 'offline' | null
export interface LocationMapState { view: MapView; notice: MapNotice }
export type LocationMapAction =
  | { type: 'show'; online: boolean }
  | { type: 'hide' }
  | { type: 'offline' }
  | { type: 'online' }

export const INITIAL_MAP_STATE: LocationMapState = { view: 'card', notice: null }

export function locationMapReducer(state: LocationMapState, action: LocationMapAction): LocationMapState {
  switch (action.type) {
    case 'show':
      // Sin red clara no se crea el iframe: la tarjeta sigue visible con un aviso.
      return action.online ? { view: 'map', notice: null } : { view: 'card', notice: 'offline' }
    case 'hide':
      return INITIAL_MAP_STATE
    case 'offline':
      // Al desconectarse se retira el iframe (cancela la petición pendiente) y vuelve la tarjeta.
      return state.view === 'map' ? { view: 'card', notice: 'offline' } : state
    case 'online':
      // Recuperar la conexión nunca reactiva el mapa: solo limpia el aviso. Cargarlo exige pulsar el botón.
      return state.view === 'card' && state.notice ? INITIAL_MAP_STATE : state
  }
}
