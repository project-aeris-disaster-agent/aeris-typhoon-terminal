/**
 * Jest stand-in for `maplibre-gl`. From v6 the package ships only an ES
 * module (its `exports` has no `require` condition), so Jest's CommonJS
 * resolver cannot load it. jsdom has no WebGL anyway, so no test can run the
 * real map: tests use `test/helpers/map-stub.ts` for map instances, and this
 * module only has to satisfy the runtime imports of map code.
 */

class Evented {
  on() {
    return this;
  }
  off() {
    return this;
  }
  once() {
    return this;
  }
}

export class Map extends Evented {
  constructor() {
    super();
    throw new Error("maplibre-gl Map is not available under Jest; mock it.");
  }
}

export class Popup extends Evented {
  setLngLat() {
    return this;
  }
  setDOMContent() {
    return this;
  }
  setHTML() {
    return this;
  }
  addTo() {
    return this;
  }
  remove() {
    return this;
  }
  isOpen() {
    return false;
  }
  getElement() {
    return document.createElement("div");
  }
}

export const getVersion = () => "0.0.0-jest";
export const setWorkerUrl = (_url: string) => {};

export class AttributionControl {}
export class NavigationControl {}
export class ScaleControl {}

export class MercatorCoordinate {
  constructor(
    public x: number,
    public y: number,
    public z = 0,
  ) {}

  static fromLngLat(lngLat: [number, number] | { lng: number; lat: number }, altitude = 0) {
    const [lng, lat] = Array.isArray(lngLat) ? lngLat : [lngLat.lng, lngLat.lat];
    const x = (180 + lng) / 360;
    const y =
      (180 - (180 / Math.PI) * Math.log(Math.tan(Math.PI / 4 + (lat * Math.PI) / 360))) / 360;
    const circumference = 2 * Math.PI * 6371008.8 * Math.cos((lat * Math.PI) / 180);
    return new MercatorCoordinate(x, y, altitude / circumference);
  }

  meterInMercatorCoordinateUnits() {
    const lat = (360 / Math.PI) * Math.atan(Math.exp(((180 - this.y * 360) * Math.PI) / 180)) - 90;
    return 1 / (2 * Math.PI * 6371008.8 * Math.cos((lat * Math.PI) / 180));
  }
}
