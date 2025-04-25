'use strict';

import Gtk from 'gi://Gtk';
import Gio from 'gi://Gio';
import Soup from 'gi://Soup';

let session;

export function init() {}

function fetchCurrencies(callback) {
    if (!session) {
        session = new Soup.Session();
    }

    const message = Soup.Message.new('GET', 'https://economia.awesomeapi.com.br/json/available/uniq');

    session.send_and_read_async(message, GLib.PRIORITY_DEFAULT, null, (source, res) => {
        try {
            let data = session.send_and_read_finish(res).get_data();
            let json = JSON.parse(new TextDecoder().decode(data));
            let codes = Object.keys(json).sort(); // Alphabetical order
            callback(codes);
        } catch (e) {
            log(`Failed to fetch currency list: ${e}`);
            callback(['USD', 'EUR']); // fallback
        }
    });
}

export function buildPrefsWidget() {
    const settings = new Gio.Settings({ schema_id: 'org.gnome.shell.extensions.currency-converter' });

    const grid = new Gtk.Grid({
        column_spacing: 12,
        row_spacing: 12,
        margin: 12,
        visible: true,
    });

    const fromLabel = new Gtk.Label({ label: "From currency:", halign: Gtk.Align.START, visible: true });
    const fromCombo = new Gtk.ComboBoxText({ visible: true });

    const toLabel = new Gtk.Label({ label: "To currency:", halign: Gtk.Align.START, visible: true });
    const toCombo = new Gtk.ComboBoxText({ visible: true });

    // Add labels to grid now
    grid.attach(fromLabel, 0, 0, 1, 1);
    grid.attach(fromCombo, 1, 0, 1, 1);
    grid.attach(toLabel, 0, 1, 1, 1);
    grid.attach(toCombo, 1, 1, 1, 1);

    fetchCurrencies((currencies) => {
        currencies.forEach(c => {
            fromCombo.append_text(c);
            toCombo.append_text(c);
        });

        const source = settings.get_string('source-currency');
        const target = settings.get_string('target-currency');

        fromCombo.set_active(currencies.indexOf(source) !== -1 ? currencies.indexOf(source) : 0);
        toCombo.set_active(currencies.indexOf(target) !== -1 ? currencies.indexOf(target) : 1);

        fromCombo.connect('changed', () => {
            settings.set_string('source-currency', fromCombo.get_active_text());
        });

        toCombo.connect('changed', () => {
            settings.set_string('target-currency', toCombo.get_active_text());
        });
    });

    return grid;
}
