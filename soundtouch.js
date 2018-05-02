/* 
 * The MIT License
 *
 * Copyright 2017 Dr. Bernd Franke <dr.bernd.franke@gmail.com>.
 *
 * Permission is hereby granted, free of charge, to any person obtaining a copy
 * of this software and associated documentation files (the "Software"), to deal
 * in the Software without restriction, including without limitation the rights
 * to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
 * copies of the Software, and to permit persons to whom the Software is
 * furnished to do so, subject to the following conditions:
 *
 * The above copyright notice and this permission notice shall be included in
 * all copies or substantial portions of the Software.
 *
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
 * OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
 * THE SOFTWARE.
 */
"use strict";
const DeviceMasterName = "Working";
const WellKnownDevices = new Array("192.168.0.90", "192.168.0.91", "192.168.0.92");

var requestPromise = require("request-promise-native");
var util = require("util");
var parseStringPromise = util.promisify(require("xml2js").parseString);
var ssdp = require("node-ssdp");

function exceptionHandler(t, e, rethrow = false) {
    if(e) {
        console.log("#### " + t + " failed! ####\n" + e + "\n\n");
        if(rethrow) {
	    throw(e);
        }
    }
    return e ? Promise.reject(e) : Promise.resolve(t);
}

function delay(time, value) {
    // console.log("delay: ", value);
    return new Promise(function (resolve) {
        setTimeout(() => {
	    // console.log(" ... finished"); 
	    resolve(value);
        }, time);
    });
}


/**
 * SoundTouchDevice class definition
 * @param {type} address
 * @returns {nm$_soundtouch.SoundTouchDevice}
 */

class SoundTouchDevice {

    constructor(address) {
        this.address = address;
        this.exceptionHandler = exceptionHandler;
        this.valid = false;
    }

    init() {
        try {
	    this.uri = "http://" + this.address + ":8090";
	    return requestPromise(this.uri + "/info")
                .then(parseStringPromise, e => Promise.reject(e))
                .then(result => {
		    this.deviceID = result.info["$"].deviceID;
		    this.name = result.info.name[0];
		    this.type = result.info.type[0];
		    this.MAC = result.info.networkInfo[0].macAddress[0];
		    this.MAC1 = result.info.networkInfo[1].macAddress[0];
		    this.IP = result.info.networkInfo[0].ipAddress[0];
		    this.IP1 = result.info.networkInfo[1].ipAddress[0];
		    this.valid = true;
                })
                .catch(e => Promise.reject(e));
        }
        catch (e) {
	    return this.exceptionHandler("init() ", e);
        }
    }

    volume(vol) {
        return requestPromise({uri: "http://" + this.address + ":8090/volume", method: "POST", body: "<volume>" + vol + "</volume>\n\n"})
	    .then(() => Promise.resolve(vol));
    }

    volumeFadeIn(volumeEnd, volumeBegin = 0, span = 20000) {
        const smax = Math.abs(Math.floor(volumeEnd - volumeBegin));
        const timeStep = span / smax;
        const volStep = (volumeEnd - volumeBegin) / smax;

        var p = Promise.resolve(volumeBegin);
        for(let s = 0; s < smax; s++) {
	    p = p.then(vol => this.volume(vol))
                .then(vol => delay(timeStep, vol + 1));
        }
        return p;
    }

    key(key) {
        return requestPromise({uri: this.uri + "/key", method: "POST", body: "<key state=\"press\" sender =\"Gabbo\">" + key + "</key>"})
	    .then(() => delay(200))
	    .then(() => requestPromise({uri: this.uri + "/key", method: "POST", body: "<key state=\"release\" sender =\"Gabbo\">" + key + "</key>"}))
	    .then(() => delay(200))
	    .then(() => Promise.resolve(key));
    }

    keySequence(keys) {
        var p = Promise.resolve(0);
        for(let i = 0; i < keys.length; i++) {
	    p = p.then(() => this.key(keys[i]));
        }
        return p;
    }
}


class SoundTouch {
    constructor() {
        this.devices = new Map();
        this.exceptionHandler = exceptionHandler;
    }

    key(key) {
        var p = Promise.resolve(key);
        for(const [address, device] of this.devices) {
	    p = p.then(() => device.key(key));
        }
        return p;
    }

    volume(vol) {
        var p = Promise.resolve(0);
        for(const [address, device] of this.devices) {
	    p = p.then(() => device.volume(vol));
        }
        return p;
    }

    volumeFadeIn(volumeEnd, volumeBegin = 0, span = 20000) {
        const smax = Math.abs(Math.floor(volumeEnd - volumeBegin));
        const timeStep = span / smax;
        const volStep = (volumeEnd - volumeBegin) / smax;

        var p = Promise.resolve(volumeBegin);
        for(let s = 0; s < smax; s++) {
	    for(const [address, device] of this.devices) {
                p = p.then(vol => device.volume(vol));
	    }
	    p = p.then(vol => delay(timeStep, vol + 1));
        }

        return p;
    }

    addDevice(address) {
        try {
	    // console.log('addDevice(): ', address);
	    var device = new SoundTouchDevice(address);
	    return device.init()
                .then(() => {
		    if(device.valid && !this.devices.has(address)) {
                        this.devices.set(address, device);
                        if(!this.deviceMaster || device.name === DeviceMasterName) {
			    this.deviceMaster = device;
                        }
		    }
		    return Promise.resolve(device);
                })
                .catch(() => Promise.resolve());
        }
        catch (e) {
	    return this.exceptionHandler("addDevice()", e);
        }
    }

    groupZone() {
        var zoneInfo = "", zoneMaster = "", zoneMember = "";

        for(let [address, device] of this.devices) {
	    if(device === this.deviceMaster) {
                zoneMaster = "<zone master=\"" + device.MAC + "\" senderIPAddress=\"" + device.IP + "\">";
	    }
	    zoneMember += "<member ipaddress=\"" + device.IP + "\">" + device.MAC + "</member>";
        }
        ;

        zoneInfo = zoneMaster + zoneMember + "</zone>";

        // for ZoneMaster
        var p = requestPromise({uri: this.deviceMaster.uri + "/setZone", method: "POST", body: zoneInfo});

        // for ZoneSlaves
        for(var [address, device] of this.devices) {
	    if(device !== this.deviceMaster) {
                p = p.then(() => {
		    requestPromise({uri: device.uri + "/addZoneSlave", method: "POST", body: zoneInfo});
                });
	    }
        }

        return p;
    }

    detect() {
        try {
	    WellKnownDevices.forEach(this.addDevice);

	    var client = new ssdp.Client();
	    client.on("response", (headers, statusCode, rinfo) => this.addDevice(rinfo.address));
	    return Promise.resolve(0)
                .then(() => {
		    client.search("urn:schemas-upnp-org:device:MediaRenderer:1");
		    return delay(2000);
                })
                .then(() => {
		    client.search("urn:schemas-upnp-org:device:MediaRenderer:1");
		    return delay(2000);
                })
                .then(() => {
		    client.search("urn:schemas-upnp-org:device:MediaRenderer:1");
		    return delay(2000);
                })
                .then(() => {
		    if(this.deviceMaster && (this.deviceMaster.name !== DeviceMasterName)) {
                        for(let device of this.devices) {
			    if(device.name === DeviceMasterName) {
                                this.deviceMaster = device;
			    }
                        }
		    }
		    return Promise.resolve(this.deviceMaster);
                });
        }
        catch (e) {
	    return this.exceptionHandler("detect()", e);
        }
    }
}


var soundtouch = new SoundTouch();
module.exports = soundtouch;

