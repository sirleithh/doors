# DOORS 2D — Online Yarış

Sol ekran sen, sağ ekran rakip. İkiniz de 1. kapıdan başlarsınız ama herkesin odaları farklıdır
(sunucu her oyuncuya ayrı tohum verir). İlk 25 kapıyı açan kazanır.

## Dosyalar (hepsi AYNI klasörde olmalı)
- server.js     -> sunucu (paket gerektirmez)
- index.html    -> oyunun kendisi
- package.json  -> barındırma servisleri için
- README.md     -> bu dosya

## 1) Bilgisayarında dene (2 dakika)
1. https://nodejs.org adresinden Node.js (LTS) kur.
2. Klasörü terminalde aç ve çalıştır:  node server.js
3. Tarayıcıda iki sekme aç: http://localhost:3000
4. Birinde "Oda kur", diğerinde çıkan kodla "Odaya katıl".

## 2) İnternetten oynamak için (arkadaşınla) — Render.com (ücretsiz)
1. GitHub'da yeni bir repo aç, 4 dosyayı yükle.
2. https://render.com -> New -> Web Service -> GitHub reponu seç.
3. Ayarlar: Runtime = Node, Build Command = (boş bırak), Start Command = node server.js, Instance = Free.
4. Deploy bitince sana https://xxxx.onrender.com gibi bir adres verir. Arkadaşına bunu gönder.
5. İkiniz de adresi açın; biriniz "Oda kur", diğeri kodla katılsın (ya da ikiniz de "Rastgele eşleş").

Not: Ücretsiz Render, 15 dk kullanılmazsa uyur; ilk açılış ~50 sn sürebilir. Oynamadan önce adresi bir kez açıp bekle.

## Hızlı alternatif (deploy yok): bilgisayarından tünelle
node server.js çalışırken başka terminalde:  npx cloudflared tunnel --url http://localhost:3000
Çıkan https adresini arkadaşına gönder.

## Ayarlar (server.js)
- TARGET = 25            kazanmak için kapı sayısı
- MIN_DOOR_MS = 3500     hile önleme (iki kapı arası minimum süre)

## Oyun kuralları
- A/D veya ok tuşları: yürü · E: kapı aç / dolaba gir-çık / anahtar al · SPACE: Screech'i kov
- Kilitli kapı: odada anahtar bulmalısın.
- Işıklar titrerse Rush/Ambush geliyor -> dolaba saklan. Ambush gidip gelir, erken çıkma.
- Karanlık odalarda sadece etrafın görünür.
- Ölürsen 4 sn sonra odanın başında dirilirsin. Her yeni kapıda +10 can.
