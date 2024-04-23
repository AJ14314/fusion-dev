import { NameAnd } from "@laoban/utils";
import { callDDF, DD, DDDecisions, findParams } from "./dependent.data";
import { Optional } from "@focuson/lens";
import { chainOfResponsibility, PartialFunction } from "@itsmworkbench/utils";


export type BasicStatus<S> = {
  paramNames: string[]
  upstreamUndefined: string[]
  upstreamChanged: string[]
  rawValue: any
  rawChanged: boolean
}
export type DDStatus<S> = BasicStatus<S> & {
  changed: boolean
  value: any
  cleared?: Boolean
  evaluated?: boolean
  needsLoad?: boolean
  /* Used to decide whether this makes any change to 'newS'. Only if true will this immediately effect newS */
  params?: any[] // only set if needsLoad or evaluated
  reason: string // just for debugging/logging. Let's us know which 'branch' of the code made this status
}

export type AllDdStatus<S> = NameAnd<DDStatus<S>>

export function getFromOptional<S, T> ( context: string, o: Optional<S, T>, s: S ): T | undefined {
  try {
    return o.getOption ( s )
  } catch ( e ) {
    throw new Error ( `Error getting from optional ${o}  for ${context}in\n${JSON.stringify ( s, null, 2 )}` )
  }
}
export function findBasics<S> ( status: NameAnd<DDStatus<S>>, dd: DD<S, any>, oldS: S, s: S ): BasicStatus<S> {
  const ps = findParams ( dd )
  const oldValue = getFromOptional ( 'oldValue', dd.target, oldS )
  const newValue = getFromOptional ( 'newValue', dd.target, s )
  let paramNames = ps.map ( p => p.name );
  return {
    paramNames,
    upstreamUndefined: paramNames.filter ( p => status[ p ] === undefined ),
    upstreamChanged: paramNames.filter ( p => status[ p ]?.rawChanged ),
    rawValue: newValue,
    rawChanged: oldValue !== newValue,
  };
}

export const calcParams = ( status: AllDdStatus<any> ) => ( paramNames: string[] ): any[] => paramNames.map ( p => {
  if ( status[ p ] === undefined ) throw new Error ( `No status for ${p} in ${Object.keys ( status )}` ) //defensive programming. We should already have 'validated' this can't happen
  return status[ p ]?.value;
} );

export const upstreamsUndefined = <S> (): PartialFunction<BasicStatus<S>, DDStatus<S>> => ({
  isDefinedAt: ( bs: BasicStatus<S> ) => bs.upstreamUndefined.length > 0,
  apply: ( bs: BasicStatus<S> ) => {
    const cleared = false
    const value = bs.rawValue
    const changed = bs.rawChanged
    return { ...bs, needsLoad: false, cleared, changed, value, reason: 'Upstream has undefined value' }
  }
});
type ParamFn = ( names: string[] ) => any[]
export const asyncUpstreamsChanged = <S> ( paramFn: ParamFn, dd: DDDecisions ): PartialFunction<BasicStatus<S>, DDStatus<S>> => ({
  isDefinedAt: ( bs: BasicStatus<S> ) => bs.upstreamChanged.length > 0 && dd.wait === true,
  apply: ( bs: BasicStatus<S> ) => {
    const params = paramFn ( bs.paramNames )
    const cleared = (dd.clearIfLoad || dd.clearIfUpstreamUndefinedOrLoad) && bs.rawValue !== undefined;
    const value = cleared ? undefined : bs.rawValue;
    const changed = value !== bs.rawValue;
    return { ...bs, needsLoad: true, cleared, changed, value, params, reason: 'Async, upstream has changed' }
  }
})
export const syncUpstreamsChanged = <S> ( paramFn: ParamFn, dd: DD<S, any> ): PartialFunction<BasicStatus<S>, DDStatus<S>> => ({
  isDefinedAt: ( bs: BasicStatus<S> ) => bs.upstreamChanged.length > 0 && !dd.wait,
  apply: ( bs: BasicStatus<S> ) => {
    const params = paramFn ( bs.paramNames )
    const value = callDDF ( dd, bs.rawValue, params );
    const changed = value !== bs.rawValue;
    return { ...bs, evaluated: true, changed, value, params, reason: 'Sync, upstream has changed' }
  }
})


export const syncAllGoodButUndefined = <S> ( paramFn: ParamFn, dd: DD<S, any> ): PartialFunction<BasicStatus<S>, DDStatus<S>> => ({
  isDefinedAt: ( bs: BasicStatus<S> ) => bs.rawValue === undefined && !dd.wait && bs.upstreamUndefined.length === 0 && bs.upstreamChanged.length === 0,
  apply: ( bs: BasicStatus<S> ) => {
    const params = paramFn ( bs.paramNames )
    const value = callDDF ( dd, bs.rawValue, params );
    return { ...bs, evaluated: true, changed: value !== bs.rawValue, value, params, reason: 'Sync, all upstreams are defined and unchanged, but we are undefined so need to evaluate' }
  }
})
export const asyncAllGoodButUndefined = <S> ( paramFn: ParamFn, dd: DD<S, any> ): PartialFunction<BasicStatus<S>, DDStatus<S>> => ({
  isDefinedAt: ( bs: BasicStatus<S> ) => bs.rawValue === undefined && dd.wait === true && bs.upstreamUndefined.length === 0 && bs.upstreamChanged.length === 0,
  apply: ( bs: BasicStatus<S> ) => {
    const params = paramFn ( bs.paramNames )
    return { ...bs, needsLoad: true, changed: false, value: bs.rawValue, params, reason: 'Async, all upstreams are defined and unchanged, but we are undefined so need to load' }
  }
})

export const allGood = <S> (): PartialFunction<BasicStatus<S>, DDStatus<S>> => ({
  isDefinedAt: ( bs: BasicStatus<S> ) => bs.rawValue !== undefined && bs.upstreamUndefined.length === 0 && bs.upstreamChanged.length === 0,
  apply: ( bs: BasicStatus<S> ) => ({ ...bs, value: bs.rawValue, changed: false, reason: 'All upstreams are defined and unchanged, our value is defined' })
})

export function calcStatusFor<S> ( status: NameAnd<DDStatus<S>>, dd: DD<S, any>, basics: BasicStatus<S> ): DDStatus<S> {
  const paramFn: ParamFn = calcParams ( status )
  const fn = chainOfResponsibility<BasicStatus<S>, DDStatus<S>> (
    ( bs ) => {throw new Error ( 'Chain didnt match for ' + JSON.stringify ( bs ) )},
    upstreamsUndefined<S> (),
    asyncUpstreamsChanged ( paramFn, dd ),
    syncUpstreamsChanged ( paramFn, dd ),
    syncAllGoodButUndefined ( paramFn, dd ),
    asyncAllGoodButUndefined ( paramFn, dd ),
    allGood<S> (),
  )
  return fn ( basics )
}

function validateNoDuplicates<S> ( dds: DD<S, any>[] ) {
  const names = dds.map ( d => d.name )
  const duplicates = names.filter ( ( n, i ) => names.indexOf ( n ) !== i )
  if ( duplicates.length > 0 ) throw new Error ( `Duplicate names: ${duplicates}` )
}
function validateParamsDefined<S> ( dds: DD<S, any>[] ) {
  const names: string[] = []
  for ( const d of dds ) {
    const params = findParams ( d )
    for ( const p of params ) {
      if ( !names.includes ( p.name ) ) throw new Error ( `Param ${p.name} not found for ${d.name}` )
    }
    names.push ( d.name )
  }
}
export function validateDDs<S> ( dds: DD<S, any>[] ) {
  validateNoDuplicates ( dds );
  validateParamsDefined ( dds );
}

export function calcStatus<S> ( status: AllDdStatus<S>, dd: DD<S, any>, oldS: S, s: S ): DDStatus<S> {
  let basics = findBasics ( status, dd, oldS, s );
  return calcStatusFor ( status, dd, basics )
}

export function calcAllStatus<S> ( dds: DD<S, any>[], oldS: S, s: S ): AllDdStatus<S> {
  const status: AllDdStatus<S> = {}
  for ( const dd of dds ) {
    try {
      status[ dd.name ] = calcStatus ( status, dd, oldS, s )
    } catch ( e ) {
      console.error ( `Error calculating status for ${dd.name} in\n${JSON.stringify ( s, null, 2 )}` )
      throw e
    }
  }
  return status
}
export function foldIntoState<S> ( dds: DD<S, any>[], status: AllDdStatus<S>, s: S ) {
  let acc = s
  for ( const dd of dds ) {
    const st = status[ dd.name ];
    acc = st.changed ? dd.target.set ( acc, st.rawValue ) : acc
  }
  return acc
}