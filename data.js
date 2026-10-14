/* سِيَر — الثوابت والبيانات الأولية */
'use strict';
const SIYAR_DATA = (function(){
const ERAS = [
  {key:'all', label:'الكل'},
  {key:'prophetic', label:'العهد النبوي'},
  {key:'rashidun', label:'الخلفاء الراشدون'},
  {key:'conquests', label:'عصر الفتوحات'},
  {key:'andalus', label:'الأندلس'},
  {key:'ayyubid', label:'العصر الأيوبي'}
];
const TYPES = {
  figure:{label:'صحابي / شخصية', short:'شخصية', portal:'بوابة الشخصيات', coll:'figures', icon:'👤', hint:'ملف كامل بفروع وأحاديث'},
  stance:{label:'موقف تاريخي',  short:'موقف',  portal:'بوابة المواقف', coll:'stances', icon:'⚔️', hint:'موقف مع صاحبه ونصه'},
  seerah:{label:'السيرة النبوية', short:'سيرة',  portal:'بوابة السيرة', coll:'seerah',  icon:'🕌', hint:'حدث من السيرة النبوية'}
};
return {ERAS, TYPES};
})();
