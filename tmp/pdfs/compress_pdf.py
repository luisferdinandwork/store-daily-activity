from pathlib import Path
from io import BytesIO
import pymupdf
from PIL import Image
from pypdf import PdfWriter,PdfReader
from pypdf.generic import NameObject,NumberObject,BooleanObject,DictionaryObject,ArrayObject,DecodedStreamObject
src=pymupdf.open(r'C:\Users\LUIS\Downloads\Tugas OJT - SJPH - Rev.pdf')
out=Path(r'output/pdf/Tugas OJT - SJPH - Rev - under 1MB.pdf')
def name(x): return NameObject('/'+x)
def stream(data,props):
 s=DecodedStreamObject();s.set_data(data);s.update({name(k):v for k,v in props.items()});return s
for dpi in [140,135,130,125]:
 w=PdfWriter(); total=0
 for i,p in enumerate(src):
  pix=p.get_pixmap(dpi=dpi,colorspace=pymupdf.csRGB,alpha=False)
  im=Image.frombytes('RGB',(pix.width,pix.height),pix.samples)
  if i==2:
   im.thumbnail((1000,1415));b=BytesIO();im.save(b,'JPEG',quality=45,optimize=True)
   data=b.getvalue(); props={'Type':name('XObject'),'Subtype':name('Image'),'Width':NumberObject(im.width),'Height':NumberObject(im.height),'ColorSpace':name('DeviceRGB'),'BitsPerComponent':NumberObject(8),'Filter':name('DCTDecode')}
  else:
   im=im.convert('L').point(lambda v: 255 if v>185 else 0,mode='1');b=BytesIO();im.save(b,'TIFF',compression='group4',strip_size=10000000);b.seek(0);t=Image.open(b);off=t.tag_v2[273];counts=t.tag_v2[279];raw=b.getvalue();data=b''.join(raw[o:o+c] for o,c in zip(off,counts))
   props={'Type':name('XObject'),'Subtype':name('Image'),'Width':NumberObject(im.width),'Height':NumberObject(im.height),'ColorSpace':name('DeviceGray'),'BitsPerComponent':NumberObject(1),'Filter':name('CCITTFaxDecode'),'DecodeParms':DictionaryObject({name('K'):NumberObject(-1),name('Columns'):NumberObject(im.width),name('Rows'):NumberObject(im.height),name('BlackIs1'):BooleanObject(True)})}
  pg=w.add_blank_page(width=p.rect.width,height=p.rect.height)
  pg[name('Resources')]=DictionaryObject({name('XObject'):DictionaryObject({name('Im0'):w._add_object(stream(data,props))})})
  pg[name('Contents')]=w._add_object(stream(f'q {p.rect.width} 0 0 {p.rect.height} 0 0 cm /Im0 Do Q'.encode(),{}))
 w.add_metadata({'/Title':'Tugas OJT - SJPH - Rev (compressed)'})
 w.write(str(out)); print('dpi',dpi,'bytes',out.stat().st_size,flush=True)
 if out.stat().st_size<990000:break
p=pymupdf.open(out)
assert len(p)==len(src)==60
for i in range(len(p)): p[i].get_pixmap(matrix=pymupdf.Matrix(.15,.15))
for i in [0,2,10,26,28,43,58]:p[i].get_pixmap(dpi=120).save(f'tmp/pdfs/check-page{i+1}.png')
print('VERIFIED',len(p),'pages',out.resolve(),out.stat().st_size)

