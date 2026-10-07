// state.js
//
// Dynamic runtime state singleton.
//
// Receives server snapshots and exposes them as:
// 
// state.runtime.gw_state
// state.bot.running
// state.anything.new_value
//
// No mappings.
// No predefined fields.
// Server controls the structure.


class NestedState {


    constructor(data = {}) {

        this._data = {};

        this.update(data);

        return new Proxy(this, {
            get: (target, property) => {
                // Allow access to _data and methods
                if (property in target) {
                    return target[property];
                }
                // Return from _data
                return target._data[property];
            }
        });

    }




    update(data) {

        if (!data || typeof data !== "object") {
            return;
        }



        for (const [key, value] of Object.entries(data)) {


            if (
                value &&
                typeof value === "object" &&
                !Array.isArray(value)
            ) {


                if (
                    this._data[key] instanceof NestedState
                ) {

                    this._data[key].update(value);

                }
                else {

                    this._data[key] =
                        new NestedState(value);

                }

            }
            else {

                this._data[key] = value;

            }

        }

    }




    clear() {

        this._data = {};

    }




    get(key, fallback = null) {

        return this._data[key] ?? fallback;

    }




    has(key) {

        return key in this._data;

    }




    keys() {

        return Object.keys(this._data);

    }




    toObject() {

        const result = {};


        for (const [key, value] of Object.entries(this._data)) {


            if (value instanceof NestedState) {

                result[key] = value.toObject();

            }
            else {

                result[key] = value;

            }

        }


        return result;

    }



}




class RuntimeState {


    constructor() {


        this._root =
            new NestedState();


        this._raw = {};

        this._fetchedAt = 0;

        this._version = 0;


        this._listeners = [];


        return new Proxy(this, {


            get(target, property) {


                // normal class properties
                if (property in target) {

                    return target[property];

                }



                // dynamic state access

                const value =
                    target._root.get(property);



                return value;

            }


        });


    }







    update(snapshot) {


        if (
            !snapshot ||
            typeof snapshot !== "object"
        ) {

            return;

        }



        this._raw = snapshot;


        this._root.update(snapshot);



        this._fetchedAt =
            snapshot._fetched_at ??
            Date.now();



        this._version =
            snapshot._ws_version ??
            0;



        this.notify();

    }








    clear() {


        this._raw = {};

        this._root.clear();

        this._fetchedAt = 0;

        this._version = 0;


    }








    subscribe(callback) {


        if (
            !this._listeners.includes(callback)
        ) {

            this._listeners.push(callback);

        }

        // Page scripts are recreated after reconnect/login while the latest
        // snapshot is still cached. Replay it so a page does not wait for a
        // future state_update just to render existing data.
        if (this.populated) {
            try {
                callback(this);
            }
            catch (error) {
                console.error("[State] Listener error", error);
            }
        }



        return () => {

            const index =
                this._listeners.indexOf(callback);


            if (index !== -1) {

                this._listeners.splice(
                    index,
                    1
                );

            }

        };


    }








    notify() {
        for (const listener of this._listeners) {

            try {
                listener(this);
            }
            catch (error) {
                console.error("[State] Listener error", error);
            }

        }


    }







    get raw() {

        return this._raw;

    }



    get fetchedAt() {

        return this._fetchedAt;

    }



    get version() {

        return this._version;

    }



    get populated() {

        return Object.keys(this._raw).length > 0;

    }

    toObject() {

        return this._root.toObject();

    }

    keys() {
        return this._root.keys();
    }
}

// Single global instance
export const state = new RuntimeState();