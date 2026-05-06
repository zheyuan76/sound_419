/**
 * Province adcode → dialect region mapping & region geo centers for Mapbox.
 */

/** Map province adcode → dialect region ID */
export const PROVINCE_TO_REGION: Record<number, string> = {
  // 北方官话区
  110000: 'north_mandarin',  // 北京
  120000: 'north_mandarin',  // 天津
  130000: 'north_mandarin',  // 河北
  140000: 'north_mandarin',  // 山西
  370000: 'north_mandarin',  // 山东
  410000: 'north_mandarin',  // 河南
  610000: 'north_mandarin',  // 陕西
  620000: 'north_mandarin',  // 甘肃
  640000: 'north_mandarin',  // 宁夏
  // 西南官话区
  500000: 'southwest_mandarin',  // 重庆
  510000: 'southwest_mandarin',  // 四川
  520000: 'southwest_mandarin',  // 贵州
  530000: 'southwest_mandarin',  // 云南
  420000: 'southwest_mandarin',  // 湖北
  430000: 'southwest_mandarin',  // 湖南
  // 江南吴语区
  310000: 'jiangnan_wu',  // 上海
  320000: 'jiangnan_wu',  // 江苏
  330000: 'jiangnan_wu',  // 浙江
  340000: 'jiangnan_wu',  // 安徽
  // 岭南粤语区
  440000: 'lingnan_yue',  // 广东
  450000: 'lingnan_yue',  // 广西
  460000: 'lingnan_yue',  // 海南
  // 闽台山海区
  350000: 'min_tai',  // 福建
  360000: 'min_tai',  // 江西
  // 东北边陲
  210000: 'northeast_frontier',  // 辽宁
  220000: 'northeast_frontier',  // 吉林
  230000: 'northeast_frontier',  // 黑龙江
  // 北部草原
  150000: 'north_grassland',  // 内蒙古
  // 西域丝路
  650000: 'western_silkroad',  // 新疆
  // 雪域高原
  540000: 'snow_highland',  // 西藏
  630000: 'snow_highland',  // 青海
  // 西南夷疆 — 云南贵州广西也有少数民族，这里保持前面归属
};

/** Region center coordinates [lng, lat] for placing markers */
export const REGION_CENTERS: Record<string, [number, number]> = {
  north_mandarin:      [115.5, 38.0],
  southwest_mandarin:  [104.5, 30.5],
  jiangnan_wu:         [120.5, 30.0],
  lingnan_yue:         [110.5, 23.0],
  min_tai:             [117.5, 26.0],
  northeast_frontier:  [127.0, 46.0],
  north_grassland:     [112.0, 43.5],
  western_silkroad:    [84.0, 41.0],
  snow_highland:       [90.0, 32.0],
  southwest_frontier:  [101.0, 25.0],
  unknown_voice:       [105.0, 35.0],
};
