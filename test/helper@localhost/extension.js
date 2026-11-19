import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js';

export default class HelperExtension extends Extension {
    /**
     * Allow D-Bus screenshot calls from the test script.
     */
    enable() {
        global.context.unsafe_mode = true;
    }

    /**
     * Restore safe mode.
     */
    disable() {
        global.context.unsafe_mode = false;
    }
}
