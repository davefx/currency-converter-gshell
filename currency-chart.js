#!/usr/bin/env gjs

imports.gi.versions.Gtk = "3.0";
const Gtk = imports.gi.Gtk;
const Gdk = imports.gi.Gdk;
const GObject = imports.gi.GObject;
const Soup = imports.gi.Soup;
const Cairo = imports.cairo;
const GLib = imports.gi.GLib;
const Gio = imports.gi.Gio;
const ByteArray = imports.byteArray;
const Mainloop = imports.mainloop;

// Initialize Gtk
Gtk.init(null);

// Chart window class
const ChartWindow = GObject.registerClass(
class ChartWindow extends Gtk.Window {
    _init(base, target) {
        super._init({ 
            title: `Exchange Rate Chart: ${base}/${target}`,
            default_width: 700,
            default_height: 500,
            window_position: Gtk.WindowPosition.CENTER
        });
        
        // Initialize properties
        this._base = base;
        this._target = target;
        this._values = [];
        this._dates = [];
        this._is_dark = this._detect_dark_theme();
        this._isLoading = false;
        this._errorMessage = null;
        this._zoomLevel = 1.0;
        
        // Set up window close handler
        this.connect('delete-event', () => {
            Mainloop.quit('mainloop');
            return false;
        });
        
        // Create main container
        this._container = new Gtk.Box({ 
            orientation: Gtk.Orientation.VERTICAL, 
            spacing: 10,
            margin: 15
        });
        
        // Create toolbar
        const toolbar = new Gtk.Box({ 
            orientation: Gtk.Orientation.HORIZONTAL, 
            spacing: 10 
        });
        
        // Add refresh button
        const refreshButton = new Gtk.Button({ label: "Refresh" });
        refreshButton.connect("clicked", this._fetch_data.bind(this));
        toolbar.pack_start(refreshButton, false, false, 0);
        
        // Add period selector
        const periodLabel = new Gtk.Label({ label: "Period:" });
        toolbar.pack_start(periodLabel, false, false, 0);
        
        this._periodCombo = new Gtk.ComboBoxText();
        this._periodCombo.append_text("7 days");
        this._periodCombo.append_text("30 days");
        this._periodCombo.append_text("60 days");
        this._periodCombo.set_active(1); // Default to 30 days
        this._periodCombo.connect("changed", () => {
            this._fetch_data();
        });
        toolbar.pack_start(this._periodCombo, false, false, 0);
        
        // Add zoom controls
        const zoomInButton = new Gtk.Button({ label: "+" });
        zoomInButton.connect("clicked", () => {
            this._zoomLevel *= 1.2;
            this._drawingArea.queue_draw();
        });
        toolbar.pack_end(zoomInButton, false, false, 0);
        
        const zoomOutButton = new Gtk.Button({ label: "-" });
        zoomOutButton.connect("clicked", () => {
            this._zoomLevel /= 1.2;
            if (this._zoomLevel < 0.5) this._zoomLevel = 0.5;
            this._drawingArea.queue_draw();
        });
        toolbar.pack_end(zoomOutButton, false, false, 0);
        
        const zoomResetButton = new Gtk.Button({ label: "Reset Zoom" });
        zoomResetButton.connect("clicked", () => {
            this._zoomLevel = 1.0;
            this._drawingArea.queue_draw();
        });
        toolbar.pack_end(zoomResetButton, false, false, 0);
        
        this._container.pack_start(toolbar, false, false, 0);
        
        // Create a DrawingArea for the chart with event handling
        this._drawingArea = new Gtk.DrawingArea();
        this._drawingArea.set_size_request(650, 350);
        this._drawingArea.connect("draw", this._onDraw.bind(this));
        this._drawingArea.add_events(Gdk.EventMask.BUTTON_PRESS_MASK | 
                                   Gdk.EventMask.BUTTON_RELEASE_MASK | 
                                   Gdk.EventMask.POINTER_MOTION_MASK);
        this._drawingArea.connect("button-press-event", this._onButtonPress.bind(this));
        this._container.pack_start(this._drawingArea, true, true, 0);
        
        // Create a status bar
        this._statusBar = new Gtk.Statusbar();
        this._container.pack_end(this._statusBar, false, false, 0);
        
        // Add container to window
        this.add(this._container);
        
        // Schedule data fetch with a short delay to ensure UI is ready
        GLib.timeout_add(GLib.PRIORITY_DEFAULT, 500, () => {
            this._fetch_data();
            return GLib.SOURCE_REMOVE; // Don't repeat
        });
    }

    _detect_dark_theme() {
        const settings = Gtk.Settings.get_default();
        if (settings) {
            const themeName = settings.get_property("gtk-theme-name", "light");
            return themeName && themeName.toLowerCase().includes("dark");
        }
        return false;
    }

    _get_period_days() {
        const activeText = this._periodCombo ? this._periodCombo.get_active_text() : "30 days";
        return parseInt(activeText.split(" ")[0]);
    }

    _fetch_data() {
        const days = this._get_period_days();
        const url = `https://economia.awesomeapi.com.br/json/daily/${this._base}-${this._target}/${days}`;

        // Show loading state
        this._showLoading();

        try {
            // Create a session - this should work for all libsoup versions
            const session = new Soup.Session();
            
            // For libsoup 3.x
            try {
                // Create message with a GLib.Uri
                let uri;
                if (typeof GLib.Uri !== 'undefined' && GLib.Uri.parse) {
                    uri = GLib.Uri.parse(url, GLib.UriFlags.NONE);
                } else {
                    // Fallback for older GLib
                    uri = url;
                }
                
                // Create a message - different constructors depending on libsoup version
                let message;
                
                try {
                    message = new Soup.Message({
                        method: 'GET', 
                        uri: uri
                    });
                } catch (e) {
                    // Fallback method
                    message = Soup.Message.new('GET', url);
                }
                
                if (!message) {
                    throw new Error("Could not create HTTP message");
                }
                
                // Handle different versions of libsoup 3.x API
                if (typeof session.send_async === 'function') {
                    // Method 1: Using send_async with various priority options
                    try {
                        // Try to call send_async with priority parameter
                        session.send_async(message, GLib.PRIORITY_DEFAULT, null, (session, result) => {
                            this._handleSendAsyncResponse(session, result, message);
                        });
                    } catch (e) {
                        // Alternative approach for different parameter order
                        try {
                            session.send_async(message, null, null, (session, result) => {
                                this._handleSendAsyncResponse(session, result, message);
                            });
                        } catch (e2) {
                            this._showError(`API error: ${e2.message}`);
                        }
                    }
                } else if (typeof session.request_http_async === 'function') {
                    // Method 2: Some versions might have request_http_async instead
                    session.request_http_async('GET', url, null, null, null, (session, result) => {
                        try {
                            const response = session.request_http_finish(result);
                            if (!response) {
                                throw new Error("Failed to get response");
                            }
                            
                            const status = response.get_status();
                            if (status !== 200) {
                                throw new Error(`HTTP error: ${status}`);
                            }
                            
                            const stream = response.get_body_stream();
                            const bytes = Gio.MemoryOutputStream.new_resizable();
                            bytes.splice(stream, Gio.OutputStreamSpliceFlags.CLOSE_TARGET, null);
                            
                            const data = bytes.steal_as_bytes().get_data();
                            const text = ByteArray.toString(data);
                            this._processResponse(text);
                        } catch (e) {
                            this._showError(`Response error: ${e.message}`);
                        }
                    });
                } else if (typeof session.queue_message === 'function') {
                    // Method 3: Fallback to queue_message for older libsoup
                    session.queue_message(message, (session, msg) => {
                        try {
                            if (msg.status_code !== 200) {
                                throw new Error(`HTTP error: ${msg.status_code}`);
                            }
                            
                            const data = msg.response_body.data;
                            this._processResponse(data);
                        } catch (e) {
                            this._showError(`Response error: ${e.message}`);
                        }
                    });
                } else {
                    // Method 4: Fallback to Gio directly 
                    const file = Gio.File.new_for_uri(url);
                    file.load_contents_async(null, (file, res) => {
                        try {
                            const [success, contents, etag_out] = file.load_contents_finish(res);
                            if (success) {
                                const responseText = ByteArray.toString(contents);
                                this._processResponse(responseText);
                            } else {
                                throw new Error("Failed to download data");
                            }
                        } catch (e) {
                            this._showError(`Gio error: ${e.message}`);
                        }
                    });
                }
            } catch (e) {
                this._showError(`Error creating request: ${e.message}`);
            }
        } catch (e) {
            this._showError(`Error setting up session: ${e.message}`);
        }
    }
    
    _handleSendAsyncResponse(session, result, message) {
        try {
            // Different response handling methods for different versions
            let input_stream;
            try {
                // Method 1: Try send_finish with input stream
                input_stream = session.send_finish(result);
                if (!input_stream) {
                    throw new Error("No input stream in response");
                }
            } catch (e) {
                // Log the error but continue trying other methods
                print(`Error with send_finish: ${e.message}`);
                
                // Try to get response via message properties
                if (message.status_code !== 200) {
                    throw new Error(`HTTP error: ${message.status_code}`);
                }
                
                if (message.response_body && message.response_body.data) {
                    // Direct access to response data
                    this._processResponse(message.response_body.data);
                    return;
                }
            }
            
            if (input_stream) {
                // Get HTTP status
                if (message.get_status() !== 200) {
                    throw new Error(`HTTP error: ${message.get_status()}`);
                }
                
                // Read the data from input stream
                const bytes = Gio.MemoryOutputStream.new_resizable();
                bytes.splice(input_stream, Gio.OutputStreamSpliceFlags.CLOSE_TARGET, null);
                
                const data = bytes.steal_as_bytes().get_data();
                const text = ByteArray.toString(data);
                this._processResponse(text);
            } else {
                throw new Error("No data received from server");
            }
        } catch (e) {
            this._showError(`Response handling error: ${e.message}`);
        }
    }
    
    _processResponse(responseText) {
        try {
            const responseData = JSON.parse(responseText);
            
            if (!Array.isArray(responseData) || responseData.length === 0) {
                throw new Error("Invalid data format or empty response");
            }
            
            // Process data - note we only reverse once to get chronological order
            const sortedData = responseData.reverse();
            this._values = sortedData.map(entry => parseFloat(entry.bid));
            this._dates = sortedData.map(entry => {
                const timestamp = parseInt(entry.timestamp);
                return GLib.DateTime.new_from_unix_local(timestamp).format("%Y-%m-%d");
            });
            
            // Hide loading indicator and trigger a redraw
            this._hideLoading();
            this._drawingArea.queue_draw();
        } catch (e) {
            this._showError("Failed to process data: " + e.message);
        }
    }

    _showLoading() {
        this._isLoading = true;
        this._errorMessage = null;
        this._statusBar.push(0, "Loading data...");
        this._drawingArea.queue_draw();
    }

    _hideLoading() {
        this._isLoading = false;
        this._statusBar.push(0, `Showing ${this._dates.length} data points`);
    }

    _showError(message) {
        this._isLoading = false;
        this._errorMessage = message;
        this._statusBar.push(0, `Error: ${message}`);
        this._drawingArea.queue_draw();
    }

    _onButtonPress(widget, event) {
        // Get the chart area dimensions to determine data point
        const width = widget.get_allocated_width();
        const height = widget.get_allocated_height();
        const paddingLeft = Math.max(60, width * 0.08);
        const paddingRight = Math.max(40, width * 0.06);
        const paddingTop = Math.max(50, height * 0.1);
        const paddingBottom = Math.max(80, height * 0.16);
        
        const chartWidth = width - paddingLeft - paddingRight;
        
        // Determine if click is within chart area
        if (event.x >= paddingLeft && 
            event.x <= width - paddingRight &&
            event.y >= paddingTop &&
            event.y <= height - paddingBottom) {
            
            // Calculate which data point was clicked
            const dataIndex = Math.round((event.x - paddingLeft) / chartWidth * (this._values.length - 1));
            
            if (dataIndex >= 0 && dataIndex < this._values.length) {
                const value = this._values[dataIndex];
                const date = this._dates[dataIndex];
                this._statusBar.push(0, `${date}: ${value.toFixed(4)} ${this._base}/${this._target}`);
            }
        }
        
        return false;
    }

    _calculateNiceStep(min, max) {
        const range = max - min;
        const magnitude = Math.pow(10, Math.floor(Math.log10(range)));
        const residual = range / magnitude;
        
        let niceFraction;
        if (residual < 1.5) {
            niceFraction = 1;
        } else if (residual < 3) {
            niceFraction = 2;
        } else if (residual < 7) {
            niceFraction = 5;
        } else {
            niceFraction = 10;
        }
        
        return niceFraction * magnitude / 5;
    }

    _onDraw(widget, cr) {
        const width = widget.get_allocated_width();
        const height = widget.get_allocated_height();
        
        // Theme colors
        const bgColor = this._is_dark ? [0.12, 0.12, 0.12] : [1, 1, 1];
        const gridColor = this._is_dark ? [0.25, 0.25, 0.25] : [0.85, 0.85, 0.85];
        const textColor = this._is_dark ? [1, 1, 1] : [0, 0, 0];
        const axisColor = this._is_dark ? [0.7, 0.7, 0.7] : [0.2, 0.2, 0.2];

        // Background
        cr.setSourceRGB(...bgColor);
        cr.rectangle(0, 0, width, height);
        cr.fill();

        // Draw title
        cr.setSourceRGB(...textColor);
        cr.selectFontFace("Sans", Cairo.FontSlant.NORMAL, Cairo.FontWeight.BOLD);
        cr.setFontSize(16);
        const titleText = `Exchange Rate: ${this._base}/${this._target} - ${this._get_period_days()} days`;
        let textExtents = cr.textExtents(titleText);
        cr.moveTo(width / 2 - textExtents.width / 2, 30);
        cr.showText(titleText);

        // Show loading or error state
        if (this._isLoading) {
            cr.setFontSize(14);
            const loadingText = "Loading data...";
            textExtents = cr.textExtents(loadingText);
            cr.moveTo(width / 2 - textExtents.width / 2, height / 2);
            cr.showText(loadingText);
            return;
        }

        if (this._errorMessage) {
            cr.setSourceRGB(0.8, 0.2, 0.2); // Red for error
            cr.setFontSize(14);
            const errorText = "Error: " + this._errorMessage;
            textExtents = cr.textExtents(errorText);
            cr.moveTo(width / 2 - textExtents.width / 2, height / 2);
            cr.showText(errorText);
            return;
        }

        if (!this._values.length) {
            cr.setFontSize(14);
            const noDataText = "No data available";
            textExtents = cr.textExtents(noDataText);
            cr.moveTo(width / 2 - textExtents.width / 2, height / 2);
            cr.showText(noDataText);
            return;
        }

        // Calculate dynamic padding based on window size
        const paddingLeft = Math.max(60, width * 0.08);
        const paddingRight = Math.max(40, width * 0.06);
        const paddingTop = Math.max(50, height * 0.1);
        const paddingBottom = Math.max(80, height * 0.16);

        const chartWidth = width - paddingLeft - paddingRight;
        const chartHeight = height - paddingTop - paddingBottom;

        // Apply zoom level to value range
        const minVal = Math.min(...this._values);
        const maxVal = Math.max(...this._values);
        // Add some padding to min/max values for better visualization
        const valueRange = maxVal - minVal;
        const midPoint = minVal + valueRange / 2;
        const zoomedRange = valueRange / this._zoomLevel;
        const adjustedMin = Math.max(0, midPoint - zoomedRange / 2);
        const adjustedMax = midPoint + zoomedRange / 2;

        // Grid lines and labels
        cr.setSourceRGB(...gridColor);
        cr.setLineWidth(1);

        // Y-axis grid and labels
        const yAxisStep = this._calculateNiceStep(adjustedMin, adjustedMax);
        const yStart = Math.floor(adjustedMin / yAxisStep) * yAxisStep;
        const yEnd = Math.ceil(adjustedMax / yAxisStep) * yAxisStep;
        
        for (let val = yStart; val <= yEnd; val += yAxisStep) {
            const y = paddingTop + chartHeight - ((val - adjustedMin) / (adjustedMax - adjustedMin)) * chartHeight;
            
            if (y >= paddingTop && y <= paddingTop + chartHeight) {
                cr.moveTo(paddingLeft, y);
                cr.lineTo(width - paddingRight, y);
                cr.stroke();

                cr.setSourceRGB(...textColor);
                cr.setFontSize(10);
                cr.moveTo(paddingLeft - 35, y + 3);
                cr.showText(val.toFixed(4));
                cr.setSourceRGB(...gridColor);
            }
        }

        // X-axis grid and labels (dates)
        const totalPoints = this._dates.length;
        // Dynamically calculate how many labels to show based on width
        const maxLabels = Math.floor(chartWidth / 80);
        const step = Math.max(Math.floor(totalPoints / maxLabels), 1);

        for (let i = 0; i < totalPoints; i += step) {
            const x = paddingLeft + (i / (totalPoints - 1)) * chartWidth;
            cr.moveTo(x, paddingTop);
            cr.lineTo(x, paddingTop + chartHeight);
            cr.stroke();

            cr.setSourceRGB(...textColor);
            cr.setFontSize(9);
            // Rotate labels for better readability
            cr.save();
            cr.translate(x, height - paddingBottom + 15);
            cr.rotate(-Math.PI / 6); // Rotate 30 degrees
            cr.moveTo(0, 0);
            cr.showText(this._dates[i]);
            cr.restore();
            
            cr.setSourceRGB(...gridColor);
        }

        // Axes
        cr.setSourceRGB(...axisColor);
        cr.setLineWidth(2);
        cr.moveTo(paddingLeft, paddingTop);
        cr.lineTo(paddingLeft, paddingTop + chartHeight);
        cr.lineTo(width - paddingRight, paddingTop + chartHeight);
        cr.stroke();

        // Chart line
        cr.setSourceRGB(0.1, 0.6, 1.0); // Blue color
        cr.setLineWidth(2);

        // Draw chart line
        let firstPoint = true;
        for (let i = 0; i < this._values.length; i++) {
            const x = paddingLeft + (i / (this._values.length - 1)) * chartWidth;
            const y = paddingTop + chartHeight - ((this._values[i] - adjustedMin) / (adjustedMax - adjustedMin)) * chartHeight;

            if (y >= paddingTop && y <= paddingTop + chartHeight) {
                if (firstPoint || (i > 0 && (this._values[i-1] < adjustedMin || this._values[i-1] > adjustedMax))) {
                    cr.moveTo(x, y);
                    firstPoint = false;
                } else {
                    cr.lineTo(x, y);
                }
            }
        }
        cr.stroke();

        // Draw data points
        for (let i = 0; i < this._values.length; i++) {
            const x = paddingLeft + (i / (this._values.length - 1)) * chartWidth;
            const y = paddingTop + chartHeight - ((this._values[i] - adjustedMin) / (adjustedMax - adjustedMin)) * chartHeight;
            
            if (y >= paddingTop && y <= paddingTop + chartHeight) {
                cr.arc(x, y, 3, 0, 2 * Math.PI);
                cr.fill();
            }
        }

        // Legend
        cr.setSourceRGB(0.1, 0.6, 1.0);
        cr.setLineWidth(10);
        cr.moveTo(width - paddingRight - 100, paddingTop - 30);
        cr.lineTo(width - paddingRight - 60, paddingTop - 30);
        cr.stroke();

        cr.setSourceRGB(...textColor);
        cr.setFontSize(10);
        cr.moveTo(width - paddingRight - 55, paddingTop - 25);
        cr.showText("Rate");

        // Add current value indicator
        if (this._values.length > 0) {
            const currentValue = this._values[this._values.length - 1];
            cr.setFontSize(12);
            cr.setSourceRGB(0.1, 0.6, 1.0);
            const valueText = `Current: ${currentValue.toFixed(4)}`;
            cr.moveTo(paddingLeft + 10, paddingTop + 20);
            cr.showText(valueText);
            
            // Show min/max values
            cr.setFontSize(10);
            cr.moveTo(paddingLeft + 10, paddingTop + 35);
            cr.showText(`Min: ${minVal.toFixed(4)}`);
            
            cr.moveTo(paddingLeft + 10, paddingTop + 50);
            cr.showText(`Max: ${maxVal.toFixed(4)}`);
            
            // Show percentage change
            const firstValue = this._values[0];
            const percentChange = ((currentValue - firstValue) / firstValue) * 100;
            const changeText = `Change: ${percentChange.toFixed(2)}%`;
            
            if (percentChange > 0) {
                cr.setSourceRGB(0.2, 0.8, 0.2); // Green for positive
            } else if (percentChange < 0) {
                cr.setSourceRGB(0.8, 0.2, 0.2); // Red for negative
            }
            
            cr.moveTo(paddingLeft + 10, paddingTop + 65);
            cr.showText(changeText);
        }
        
        // Show zoom level indicator
        cr.setSourceRGB(...textColor);
        cr.setFontSize(10);
        cr.moveTo(width - paddingRight - 100, paddingTop - 15);
        cr.showText(`Zoom: ${this._zoomLevel.toFixed(1)}x`);

        // Current date/time
        const currentDate = new Date();
        const dateString = currentDate.toISOString().split('T')[0];
        const timeString = currentDate.toTimeString().split(' ')[0];
        cr.setFontSize(8);
        cr.moveTo(width - 120, height - 10);
        cr.showText(`Updated: ${dateString} ${timeString}`);
    }
});

// Main entry point
function main(args) {
    if (args.length < 2) {
        print("Usage: currency-chart BASE TARGET");
        print("Example: currency-chart USD BRL");
        return 1;
    }

    try {
        // Create and show the window
        const win = new ChartWindow(args[0], args[1]);
        win.show_all();
        
        // Process any pending events before entering main loop
        while (Gtk.events_pending())
            Gtk.main_iteration();
        
        // Enter main loop
        Mainloop.run('mainloop');
        
        return 0;
    } catch (e) {
        print(`ERROR: ${e.message}`);
        if (e.stack) {
            print(`Stack trace: ${e.stack}`);
        }
        return 1;
    }
}

main(ARGV);
