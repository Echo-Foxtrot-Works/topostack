import type { UnitSystem } from "../types.js";

export const MM_PER_INCH = 25.4;
export const FEET_PER_METER = 3.280839895;
/** Mean Earth radius (IUGG), for every ground distance TopoStack measures on the sphere. */
export const EARTH_RADIUS_M = 6_371_008.8;

export function displayLength(valueMm: number, units: UnitSystem): number {
  return units === "imperial" ? valueMm / MM_PER_INCH : valueMm;
}

export function millimetersFromDisplay(value: number, units: UnitSystem): number {
  return units === "imperial" ? value * MM_PER_INCH : value;
}

export function displayElevation(valueM: number, units: UnitSystem): number {
  return units === "imperial" ? valueM * FEET_PER_METER : valueM;
}

export function lengthUnit(units: UnitSystem): "in" | "mm" {
  return units === "imperial" ? "in" : "mm";
}

export function elevationUnit(units: UnitSystem): "ft" | "m" {
  return units === "imperial" ? "ft" : "m";
}

function niceScaleDistance(maximumM: number): number {
  if (!(maximumM > 0)) return 0;
  const power = 10 ** Math.floor(Math.log10(maximumM));
  return [5, 2, 1].map((factor) => factor * power).find((value) => value <= maximumM) ?? power;
}

export function scaleMarking(maximumM: number, units: UnitSystem): { distanceM: number; label: string } {
  if (units === "metric") {
    const distanceM = niceScaleDistance(maximumM);
    return { distanceM, label: distanceM >= 1000 ? `${Number((distanceM / 1000).toFixed(1))} km` : `${Math.round(distanceM)} m` };
  }
  const maximumFeet = maximumM * FEET_PER_METER;
  if (maximumFeet >= 2640) {
    const miles = niceScaleDistance(maximumFeet / 5280);
    return { distanceM: miles * 5280 / FEET_PER_METER, label: `${Number(miles.toFixed(1))} mi` };
  }
  const feet = niceScaleDistance(maximumFeet);
  return { distanceM: feet / FEET_PER_METER, label: `${Math.round(feet)} ft` };
}
