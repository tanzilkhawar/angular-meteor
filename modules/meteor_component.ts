'use strict';

import {OnDestroy, NgZone, createNgZone} from 'angular2/core';
import {MeteorCallbacks, isMeteorCallbacks,
        isCallbacksObject, subscribeEvents} from './utils';
import {PromiseQueue} from './promise_queue';

export class MeteorComponent implements OnDestroy {
  private _hAutoruns: Array<Tracker.Computation> = [];
  private _hSubscribes: Array<Meteor.SubscriptionHandle> = [];
  private _zone: NgZone;

  /**
   * @param {NgZone} ngZone added for test purposes mostly.
   */
  constructor(ngZone?: NgZone) {
    this._zone = ngZone || createNgZone();
  }

  autorun(func: (c: Tracker.Computation) => any, autoBind?: boolean): Tracker.Computation {
    let hAutorun = Tracker.autorun(autoBind ? <() => void>this._bindToNgZone(func) : func);
    this._hAutoruns.push(hAutorun);

    return hAutorun;
  }

  /**
   *  Method has the same notation as Meteor.subscribe:
   *    subscribe(name, [args1, args2], [callbacks], [autobind])
   *  except one additional last parameter,
   *  which binds [callbacks] to the ng2 zone.
   */
  subscribe(name: string, ...args): Meteor.SubscriptionHandle {
    let subArgs = this._prepMeteorArgs(args.slice());

    if (!Meteor.subscribe) {
      throw new Error(
        'Meteor.subscribe is not defined on the server side');
    };

    let hSubscribe = Meteor.subscribe(name, ...subArgs);

    if (Meteor.isClient) {
      this._hSubscribes.push(hSubscribe);
    };

    if (Meteor.isServer) {
      let callback = subArgs[subArgs.length - 1];
      if (_.isFunction(callback)) {
        callback();
      }

      if (isCallbacksObject(callback)) {
        callback.onReady();
      }
    }

    return hSubscribe;
  }

  call(name: string, ...args) {
    let callArgs = this._prepMeteorArgs(args.slice());

    return Meteor.call(name, ...callArgs);
  }

  _prepMeteorArgs(args) {
    let lastParam = args[args.length - 1];
    let penultParam = args[args.length - 2];

    if (_.isBoolean(lastParam) && isMeteorCallbacks(penultParam)) {
      let callbacks = <MeteorCallbacks>penultParam;
      let autobind = <boolean>lastParam;
      if (autobind) {
        args[args.length - 2] = this._bindToNgZone(callbacks);
      }
      // Removes last params since its specific to MeteorComponent.
      args.pop();
    }

    if (isMeteorCallbacks(args[args.length - 1])) {
      args[args.length - 1] = PromiseQueue.wrapPush(args[args.length - 1]);
    }

    return args;
  }

  ngOnDestroy() {
    for (let hAutorun of this._hAutoruns) {
      hAutorun.stop();
    }

    for (let hSubscribe of this._hSubscribes) {
      hSubscribe.stop();
    }

    this._hAutoruns = null;
    this._hSubscribes = null;
  }

  _bindToNgZone(callbacks: MeteorCallbacks): MeteorCallbacks {
    const self = this;

    if (_.isFunction(callbacks)) {
      return function(...args) {
        self._zone.run(() => callbacks.apply(self._zone, args));
      };
    }

    if (isCallbacksObject(callbacks)) {
      // Bind zone for each event.
      let newCallbacks = _.clone(callbacks);
      subscribeEvents.forEach(event => {
        if (newCallbacks[event]) {
          newCallbacks[event] = function(...args) {
            self._zone.run(() => callbacks[event].apply(self._zone, args));
          };
        }
      });
      return newCallbacks;
    }

    return callbacks;
  }
}
