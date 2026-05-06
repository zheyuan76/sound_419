export interface Dialect {
  id: string;
  name: string;
}

export interface RegionCard {
  id: string;
  name: string;
  category: 'HAN_DIALECT' | 'MINORITY_LANG' | 'CUSTOM_OTHER';
  colorTheme: string;
  visualTag: string;
  dialects: Dialect[];
}

export const REGION_GROUPS = [
  { key: 'HAN_DIALECT' as const, label: '汉语方言' },
  { key: 'MINORITY_LANG' as const, label: '少数民族' },
  { key: 'CUSTOM_OTHER' as const, label: '自定义' },
];

export const REGIONS: RegionCard[] = [
  // ---- 汉语方言 ----
  // ---- 汉语方言（矿物色·低饱和） ----
  {
    id: 'north_mandarin',
    name: '北方官话区',
    category: 'HAN_DIALECT',
    colorTheme: '#A0503C',  // 赭石 — 北方黄土
    visualTag: '黄土',
    dialects: [
      { id: 'beijing', name: '北京话' },
      { id: 'tianjin', name: '天津话' },
      { id: 'jinan', name: '济南话' },
      { id: 'zhengzhou', name: '郑州话' },
    ],
  },
  {
    id: 'southwest_mandarin',
    name: '西南官话区',
    category: 'HAN_DIALECT',
    colorTheme: '#B8804A',  // 藤黄 — 蜀地暖光
    visualTag: '竹林',
    dialects: [
      { id: 'chengdu', name: '成都话' },
      { id: 'chongqing', name: '重庆话' },
      { id: 'kunming', name: '昆明话' },
      { id: 'guiyang', name: '贵阳话' },
    ],
  },
  {
    id: 'jiangnan_wu',
    name: '江南吴语区',
    category: 'HAN_DIALECT',
    colorTheme: '#5C8A99',  // 石青 — 江南水色
    visualTag: '流水',
    dialects: [
      { id: 'shanghai', name: '上海话' },
      { id: 'suzhou', name: '苏州话' },
      { id: 'wenzhou', name: '温州话' },
      { id: 'ningbo', name: '宁波话' },
    ],
  },
  {
    id: 'lingnan_yue',
    name: '岭南粤语区',
    category: 'HAN_DIALECT',
    colorTheme: '#9E5B6C',  // 胭脂 — 岭南花事
    visualTag: '醒狮',
    dialects: [
      { id: 'guangzhou', name: '广州话' },
      { id: 'hongkong', name: '香港话' },
      { id: 'nanning', name: '南宁话' },
      { id: 'taishan', name: '台山话' },
    ],
  },
  {
    id: 'min_tai',
    name: '闽台山海区',
    category: 'HAN_DIALECT',
    colorTheme: '#4A7A8C',  // 花青 — 海峡深蓝
    visualTag: '海浪',
    dialects: [
      { id: 'fuzhou', name: '福州话' },
      { id: 'xiamen', name: '厦门话' },
      { id: 'chaozhou', name: '潮州话' },
      { id: 'taiwan', name: '台湾闽南语' },
    ],
  },

  // ---- 少数民族（矿物色·低饱和） ----
  {
    id: 'northeast_frontier',
    name: '东北边陲',
    category: 'MINORITY_LANG',
    colorTheme: '#B08D84',  // 绢粉 — 边陲暖灰
    visualTag: '长鼓',
    dialects: [
      { id: 'korean', name: '朝鲜语' },
      { id: 'manchu', name: '满语' },
      { id: 'hezhe', name: '赫哲语' },
    ],
  },
  {
    id: 'north_grassland',
    name: '北部草原',
    category: 'MINORITY_LANG',
    colorTheme: '#6B8F5E',  // 草绿 — 大漠青草
    visualTag: '呼麦',
    dialects: [
      { id: 'mongolian', name: '蒙古语' },
      { id: 'daur', name: '达斡尔语' },
      { id: 'ewenki', name: '鄂温克语' },
    ],
  },
  {
    id: 'western_silkroad',
    name: '西域丝路',
    category: 'MINORITY_LANG',
    colorTheme: '#C4A243',  // 雌黄 — 丝路金沙
    visualTag: '沙漠',
    dialects: [
      { id: 'uyghur', name: '维吾尔语' },
      { id: 'kazakh', name: '哈萨克语' },
      { id: 'tajik', name: '塔吉克语' },
    ],
  },
  {
    id: 'snow_highland',
    name: '雪域高原',
    category: 'MINORITY_LANG',
    colorTheme: '#7A6B8A',  // 紫矿 — 高原薄暮
    visualTag: '哈达',
    dialects: [
      { id: 'tibetan_lhasa', name: '拉萨藏语' },
      { id: 'tibetan_amdo', name: '安多藏语' },
      { id: 'tibetan_kham', name: '康巴藏语' },
    ],
  },
  {
    id: 'southwest_frontier',
    name: '西南夷疆',
    category: 'MINORITY_LANG',
    colorTheme: '#5A8F82',  // 铜绿 — 西南山翠
    visualTag: '银饰',
    dialects: [
      { id: 'zhuang', name: '壮语' },
      { id: 'miao', name: '苗语' },
      { id: 'yi', name: '彝语' },
      { id: 'dai', name: '傣语' },
    ],
  },

  // ---- 自定义 ----
  {
    id: 'unknown_voice',
    name: '无名之声',
    category: 'CUSTOM_OTHER',
    colorTheme: 'rgba(180,170,155,0.5)',  // 淡墨灰
    visualTag: '迷雾',
    dialects: [
      { id: 'custom', name: '自定义语音' },
    ],
  },
];

export function getRegionsByCategory(category: RegionCard['category']) {
  return REGIONS.filter((r) => r.category === category);
}

export function getRegionById(id: string) {
  return REGIONS.find((r) => r.id === id);
}
