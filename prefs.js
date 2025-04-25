'use strict';

import Gtk from 'gi://Gtk';
import Gio from 'gi://Gio';
import Soup from 'gi://Soup';
import Adw from 'gi://Adw';

export default class CurrencyPrefs {
    constructor() {
        this._settings = new Gio.Settings({
            schema_id: 'org.gnome.shell.extensions.currency-converter',
        });
    }

    fillPreferencesWindow(window) {
        const page = new Adw.PreferencesPage();
        const group = new Adw.PreferencesGroup({ title: 'Currency Settings' });

        // FROM currency
        const fromRow = new Adw.ActionRow({ title: 'From currency', subtitle: 'Select source currency' });
        this._fromCombo = new Gtk.ComboBoxText({ visible: true });
        fromRow.add_suffix(this._fromCombo);
        fromRow.activatable_widget = this._fromCombo;

        // TO currency
        const toRow = new Adw.ActionRow({ title: 'To currency', subtitle: 'Select target currency' });
        this._toCombo = new Gtk.ComboBoxText({ visible: true });
        toRow.add_suffix(this._toCombo);
        toRow.activatable_widget = this._toCombo;

        // Refresh button
        const refreshButton = new Gtk.Button({
            label: "Refresh currencies",
            visible: true,
            halign: Gtk.Align.CENTER,
        });
        refreshButton.connect('clicked', () => {
            this._loadCurrencies();
        });

        group.add(fromRow);
        group.add(toRow);
        page.add(group);

	const extraGroup = new Adw.PreferencesGroup();
	const buttonBox = new Gtk.Box({
	    orientation: Gtk.Orientation.VERTICAL,
	    halign: Gtk.Align.CENTER,
	    margin_top: 12,
	    margin_bottom: 12,
	    visible: true,
	});
	buttonBox.append(refreshButton);
	extraGroup.add(buttonBox);
	page.add(extraGroup); 

        window.add(page);
        // Load currencies initially
        this._loadCurrencies();
    }

    _loadCurrencies() {
        const session = new Soup.Session();
        const message = Soup.Message.new('GET', 'https://economia.awesomeapi.com.br/json/available/uniq');

        session.send_and_read_async(message, 0, null, (source, result) => {
            try {
                const bytes = session.send_and_read_finish(result).get_data();
                const json = JSON.parse(new TextDecoder().decode(bytes));
                const currencies = Object.keys(json).sort();

                // Clear previous entries
                this._fromCombo.remove_all();
                this._toCombo.remove_all();

                for (const c of currencies) {
                    this._fromCombo.append_text(c);
                    this._toCombo.append_text(c);
                }

                const currentFrom = this._settings.get_string('source-currency');
                const currentTo = this._settings.get_string('target-currency');

                this._fromCombo.set_active(currencies.indexOf(currentFrom) !== -1 ? currencies.indexOf(currentFrom) : 0);
                this._toCombo.set_active(currencies.indexOf(currentTo) !== -1 ? currencies.indexOf(currentTo) : 1);

                this._fromCombo.connect('changed', () => {
                    this._settings.set_string('source-currency', this._fromCombo.get_active_text());
                });

                this._toCombo.connect('changed', () => {
                    this._settings.set_string('target-currency', this._toCombo.get_active_text());
                });

            } catch (e) {
                log(`Currency fetch failed: ${e}`);
            }
        });
    }
}
