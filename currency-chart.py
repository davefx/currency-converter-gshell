#!/usr/bin/env python3

import sys
import gi
import requests
import datetime

gi.require_version("Gtk", "4.0")
from gi.repository import Gtk, cairo, Gio

class ChartWindow(Gtk.ApplicationWindow):
    def __init__(self, app, base, target):
        super().__init__(application=app)
        self.set_title(f"Exchange Rate Chart: {base}/{target} - Last 30 Days")
        self.set_default_size(700, 500)

        self.base = base
        self.target = target
        self.values = []
        self.dates = []
        self.is_dark = self.detect_dark_theme()

        self.drawing_area = Gtk.DrawingArea()
        self.drawing_area.set_content_width(700)
        self.drawing_area.set_content_height(500)
        self.drawing_area.set_draw_func(self.on_draw)
        self.set_child(self.drawing_area)

        self.fetch_data()

    def detect_dark_theme(self):
        settings = Gtk.Settings.get_default()
        if settings:
            return settings.get_property("gtk-theme-name") and "dark" in settings.get_property("gtk-theme-name").lower()
        return False

    def fetch_data(self):
        url = f"https://economia.awesomeapi.com.br/json/daily/{self.base}-{self.target}/30"
        response = requests.get(url)
        if response.status_code == 200:
            data = response.json()
            self.values = [float(entry["bid"]) for entry in reversed(data)]
            self.dates = [datetime.datetime.fromtimestamp(int(entry["timestamp"])).strftime("%Y-%m-%d") for entry in reversed(data)]
            self.drawing_area.queue_draw()

    def on_draw(self, area, cr, width, height):
        if not self.values:
            return

        min_val = min(self.values)
        max_val = max(self.values)

        padding_left = 60
        padding_right = 40
        padding_top = 50
        padding_bottom = 80

        chart_width = width - padding_left - padding_right
        chart_height = height - padding_top - padding_bottom

        # Theme colors
        bg_color = (0.12, 0.12, 0.12) if self.is_dark else (1, 1, 1)
        grid_color = (0.25, 0.25, 0.25) if self.is_dark else (0.85, 0.85, 0.85)
        text_color = (1, 1, 1) if self.is_dark else (0, 0, 0)
        axis_color = (0.7, 0.7, 0.7) if self.is_dark else (0.2, 0.2, 0.2)

        # Background
        cr.set_source_rgb(*bg_color)
        cr.paint()

        # Draw title
        cr.set_source_rgb(*text_color)
        cr.select_font_face("Sans", 0, 1)  # Bold
        cr.set_font_size(16)
        cr.move_to(width / 2 - 120, 30)
        cr.show_text(f"Exchange Rate: {self.base}/{self.target}")

        # Grid lines and labels
        cr.set_source_rgb(*grid_color)
        cr.set_line_width(1)

        # Y axis grid and labels
        for i in range(6):
            y = padding_top + i * (chart_height / 5)
            cr.move_to(padding_left, y)
            cr.line_to(width - padding_right, y)
            cr.stroke()

            val = max_val - (i * (max_val - min_val) / 5)
            cr.set_source_rgb(*text_color)
            cr.set_font_size(10)
            cr.move_to(5, y + 3)
            cr.show_text(f"{val:.2f}")
            cr.set_source_rgb(*grid_color)

        # X axis grid and labels (dates)
        total_points = len(self.dates)
        step = max(total_points // 5, 1)

        for i in range(0, total_points, step):
            x = padding_left + (i / (total_points - 1)) * chart_width
            cr.move_to(x, padding_top)
            cr.line_to(x, padding_top + chart_height)
            cr.stroke()

            cr.set_source_rgb(*text_color)
            cr.set_font_size(9)
            cr.move_to(x - 20, height - padding_bottom + 30)
            cr.show_text(self.dates[i])
            cr.set_source_rgb(*grid_color)

        # Axes
        cr.set_source_rgb(*axis_color)
        cr.set_line_width(2)
        cr.move_to(padding_left, padding_top)
        cr.line_to(padding_left, padding_top + chart_height)
        cr.line_to(width - padding_right, padding_top + chart_height)
        cr.stroke()

        # Chart line
        cr.set_source_rgb(0.1, 0.6, 1.0)  # blue
        cr.set_line_width(2)

        for idx, val in enumerate(self.values):
            x = padding_left + (idx / (len(self.values) - 1)) * chart_width
            y = padding_top + ((max_val - val) / (max_val - min_val)) * chart_height

            if idx == 0:
                cr.move_to(x, y)
            else:
                cr.line_to(x, y)

        cr.stroke()

        # Legend
        cr.set_source_rgb(0.1, 0.6, 1.0)
        cr.set_line_width(10)
        cr.move_to(width - padding_right - 100, padding_top - 30)
        cr.line_to(width - padding_right - 60, padding_top - 30)
        cr.stroke()

        cr.set_source_rgb(*text_color)
        cr.set_font_size(10)
        cr.move_to(width - padding_right - 55, padding_top - 25)
        cr.show_text("Rate")

class ChartApp(Gtk.Application):
    def __init__(self, base, target):
        super().__init__()
        self.base = base
        self.target = target

    def do_activate(self):
        win = ChartWindow(self, self.base, self.target)
        win.present()

def main():
    if len(sys.argv) < 3:
        print("Usage: currency-chart BASE TARGET")
        return

    app = ChartApp(sys.argv[1], sys.argv[2])
    app.run(None)

if __name__ == "__main__":
    main()
