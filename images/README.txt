Daktilo Handbilder

Originale:
  A.png ... Z.png, Ä.png, Ö.png, Ü.png, ß.png, SCH.png
Optional später auch Varianten wie A_01.png, A_02.png usw.

Für schnelle Darstellung erzeugt Daktilo drei optimierte WebP-Größen:
  images/480/
  images/800/
  images/1200/

Erzeugen:
  python -m pip install pillow
  python tools/build_responsive_images.py

Der Browser wählt danach automatisch EINE passende Größenklasse anhand der
tatsächlichen Bildschirmfläche und Pixeldichte. Die Pixeldichte wird bewusst
bei 1,5x gedeckelt, damit Speicherbedarf und Decodierzeit nicht unnötig steigen.

Wenn keine optimierten Dateien vorhanden sind, funktioniert Daktilo weiterhin
mit den Originalbildern. Es entstehen dabei keine zusätzlichen 404-Abfragen,
weil responsive-manifest.js standardmäßig deaktiviert ist.
