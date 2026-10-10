import { DialogueTurn } from '../types';

export interface Scenario {
  id: string;
  title: string;
  prompt: string;
  topic: string;
  prebaked_turns?: DialogueTurn[];
}

export const SCENARIOS: Scenario[] = [
  {
    id: 'cafe',
    title: 'Gọi cà phê & trà sữa',
    prompt: 'At a Taiwanese coffee shop ordering drinks with customized sweetness and ice',
    topic: 'food',
    prebaked_turns: [
      {
        character_tw: '你好！歡迎光臨，今天想要喝點什麼呢？',
        character_pinyin: 'Nǐ hǎo! Huānyíng guānglín, jīntiān xiǎng yào hē diǎn shénme ne?',
        character_vi: 'Xin chào! Hoan nghênh quý khách, hôm nay bạn muốn uống gì nào?',
        character_en: 'Hello! Welcome, what would you like to drink today?',
        options: [
          {
            tw: '我要一杯珍珠奶茶，微糖微冰。',
            pinyin: 'Wǒ yào yībēi zhēnzhū nǎichá, wéi táng wéi bīng.',
            vi: 'Cho tôi một ly trà sữa trân châu, ít đường ít đá.',
            en: 'I would like a pearl milk tea, low sugar, low ice.',
          },
          {
            tw: '隨便給我一杯隨便的飲料。',
            pinyin: 'Suíbiàn gěi wǒ yībēi suíbiàn de yǐnliào.',
            vi: 'Tùy tiện cho tôi ly nước gì cũng được. (Không tự nhiên)',
            en: 'Give me whatever drink.',
          },
          {
            tw: '你這裡有什麼東西？快點拿給我。',
            pinyin: 'Nǐ zhèlǐ yǒu shénme dōngxī? Kuài diǎn ná gěi wǒ.',
            vi: 'Ở đây có đồ gì? Mau đưa tôi. (Thô lỗ)',
            en: 'What do you have here? Hurry up and give it to me.',
          },
        ],
        correct_index: 0,
      },
      {
        character_tw: '好的，珍珠奶茶微糖微冰。請問大杯還是中杯？需要加厚奶嗎？',
        character_pinyin: 'Hǎo de, zhēnzhū nǎichá wéi táng wéi bīng. Qǐngwèn dà bēi háishì zhōng bēi? Xūyào jiā hòu nǎi ma?',
        character_vi: 'Dạ vâng, trà sữa trân châu ít đường ít đá. Cho hỏi ly lớn hay vừa? Có cần thêm sữa béo không?',
        character_en: 'Okay, boba milk tea low sugar low ice. Large or medium? Need extra cream?',
        options: [
          {
            tw: '大杯的就好，不用加厚奶，謝謝！',
            pinyin: 'Dà bēi de jiù hǎo, bùyòng jiā hòu nǎi, xièxiè!',
            vi: 'Ly lớn là được rồi, không cần thêm sữa béo, cảm ơn!',
            en: 'Large is fine, no extra cream needed, thank you!',
          },
          {
            tw: '中杯，但是要放很多大陸的調味料。',
            pinyin: 'Zhōng bēi, dànshì yào fàng hěnduō dàlù de tiáowèiliào.',
            vi: 'Ly vừa, nhưng cho nhiều gia vị Đại Lục vào. (Kỳ cục)',
            en: 'Medium, but add lots of mainland seasoning.',
          },
          {
            tw: '我不要付大杯的錢，但是要喝大杯。',
            pinyin: 'Wǒ bùyào fù dà bēi de qián, dànshì yào hē dà bēi.',
            vi: 'Tôi không trả tiền ly lớn nhưng muốn uống ly lớn. (Sai ngữ cảnh)',
            en: 'I do not want to pay for large but want large.',
          },
        ],
        correct_index: 0,
      },
      {
        character_tw: '一共是65元。請問要印發票還是刷載具？',
        character_pinyin: 'Yígòng shì liùshíwǔ yuán. Qǐngwèn yào yìn fāpiào háishì shuā zǎijù?',
        character_vi: 'Tổng cộng 65 Đài tệ. Bạn muốn in hóa đơn giấy hay quét mã ví điện tử (tải cụ)?',
        character_en: 'Total is 65 NTD. Would you like a paper receipt or mobile barcode carrier?',
        options: [
          {
            tw: '不好意思，麻煩幫我刷載具，謝謝您！',
            pinyin: 'Bù hǎoyìsi, máfan bāng wǒ shuā zǎijù, xièxiè nín!',
            vi: 'Ngại quá, phiền bạn quét giúp ví tải cụ, cảm ơn bạn nhiều!',
            en: 'Excuse me, could you scan my carrier, thank you!',
          },
          {
            tw: '印紙本發票就好，用悠遊卡結帳。',
            pinyin: 'Yìn zhǐběn fāpiào jiù hǎo, yòng Yōuyóukǎ jiézhàng.',
            vi: 'In hóa đơn giấy là được, thanh toán bằng thẻ EasyCard.',
            en: 'Paper receipt is fine, paying with EasyCard.',
          },
          {
            tw: '刷載具喔！現金給您，甘溫啦～',
            pinyin: 'Shuā zǎijù ō! Xiànjīn gěi nín, gǎn-ūn la~',
            vi: 'Quét tải cụ nha! Tiền mặt gửi bạn, cảm ơn nhiều nha~',
            en: 'Scan carrier please! Cash here, thanks a lot~',
          },
        ],
        correct_index: 0,
        is_final: true,
      },
    ],
  },
  {
    id: 'directions',
    title: 'Hỏi đường & MRT ga tàu',
    prompt: 'Asking a local for directions to the MRT station or night market in Taipei',
    topic: 'travel',
    prebaked_turns: [
      {
        character_tw: '哈囉，我看你在看地圖，請問需要幫忙嗎？',
        character_pinyin: 'Hāluō, wǒ kàn nǐ zài kàn dìtú, qǐngwèn xūyào bāngmáng ma?',
        character_vi: 'Alo bạn, thấy bạn đang xem bản đồ, có cần mình giúp gì không?',
        character_en: 'Hello, I see you looking at a map, do you need some help?',
        options: [
          {
            tw: '不好意思，請問最近的捷運站在哪裡？',
            pinyin: 'Bù hǎoyìsi, qǐngwèn zuìjìn de jiéyùn zhàn zài nǎlǐ?',
            vi: 'Ngại quá, cho mình hỏi ga MRT gần nhất ở đâu vậy?',
            en: 'Excuse me, where is the nearest MRT station?',
          },
          {
            tw: '帶我去捷運站，快一點。',
            pinyin: 'Dài wǒ qù jiéyùn zhàn, kuài yìdiǎn.',
            vi: 'Dẫn tôi đi ga MRT, nhanh lên. (Bất lịch sự)',
            en: 'Take me to the MRT station, hurry up.',
          },
          {
            tw: '地鐵站呢？地鐵怎麼走？',
            pinyin: 'Dìtiě zhàn ne? Dìtiě zěnme zǒu?',
            vi: 'Trạm "địa thiết" ở đâu? (Người Đài dùng "捷運", không dùng "地鐵")',
            en: 'Where is the metro? (Mainland term)',
          },
        ],
        correct_index: 0,
      },
      {
        character_tw: '前面路口右轉走兩分鐘就看到2號出口了。你是要去哪一站？',
        character_pinyin: 'Qiánmiàn lùkǒu yòuzhuǎn zǒu liǎng fēnzhōng jiù kàndào èr hào chūkǒu le. Nǐ shì yào qù nǎ yí zhàn?',
        character_vi: 'Ngã tư phía trước quẹo phải đi 2 phút là thấy cửa số 2 rồi. Bạn tính đi trạm nào vậy?',
        character_en: 'Turn right at the intersection ahead, walk 2 mins to exit 2. Which station are you going to?',
        options: [
          {
            tw: '我要去台北101，是不是搭紅線直達？',
            pinyin: 'Wǒ yào qù Táiběi yī-líng-yī, shì bú shì dā Hóngxiàn zhídá?',
            vi: 'Mình tính đến Taipei 101, có phải bắt tuyến đỏ (Đạm Thủy - Tín Nghĩa) đi thẳng tới không?',
            en: 'I am going to Taipei 101, can I take the Red Line directly?',
          },
          {
            tw: '我不想告訴你我去哪裡。',
            pinyin: 'Wǒ bù xiǎng gàosù nǐ wǒ qù nǎlǐ.',
            vi: 'Tôi không muốn nói cho bạn tôi đi đâu.',
            en: 'I do not want to tell you where I am going.',
          },
          {
            tw: '我要去搭公交車去高鐵。',
            pinyin: 'Wǒ yào qù dā gōngjiāochē qù gāotiě.',
            vi: 'Tôi đi xe "công giao" (Người Đài dùng "公車", không dùng "公交車").',
            en: 'I want to take public bus.',
          },
        ],
        correct_index: 0,
      },
      {
        character_tw: '對！直接搭淡水信義線，不用轉車，大概四站就到了。',
        character_pinyin: 'Duì! Zhíjiē dā Dànshuǐ Xìnyì xiàn, bùyòng zhuǎnchē, dàgài sì zhàn jiù dào le.',
        character_vi: 'Đúng rồi! Đi thẳng tuyến Đạm Thủy Tín Nghĩa, không cần đổi tàu, tầm 4 ga là tới.',
        character_en: 'Yes! Take Tamsui-Xinyi Line directly, no transfers, about 4 stops.',
        options: [
          {
            tw: '太感謝您了，您真熱心，祝您今天順利！',
            pinyin: 'Tài gǎnxiè nín le, nín zhēn rèxīn, zhù nín jīntiān shùnlì!',
            vi: 'Cảm ơn bạn rất nhiều, bạn nhiệt tình quá, chúc bạn hôm nay vạn sự thuận lợi!',
            en: 'Thank you so much, you are so kind, have a great day!',
          },
          {
            tw: '好的，資訊很清楚，謝謝你的幫忙。',
            pinyin: 'Hǎo de, zīxùn hěn qīngchǔ, xièxiè nǐ de bāngmáng.',
            vi: 'Được rồi, thông tin rất rõ ràng, cảm ơn sự giúp đỡ của bạn.',
            en: 'Okay, clear information, thanks for your help.',
          },
          {
            tw: '阿捏喔！太讚了啦，甘溫蛤～',
            pinyin: 'A-ne o! Tài zàn le la, gǎn-ūn ha~',
            vi: 'Thế hả! Đỉnh quá luôn á, đa tạ nhiều nha～',
            en: 'Oh really! Awesome, thanks a bunch~',
          },
        ],
        correct_index: 0,
        is_final: true,
      },
    ],
  },
  {
    id: 'colleague',
    title: 'Chào đồng nghiệp mới',
    prompt: 'First day at an office in Taiwan, introducing yourself to a new colleague during break',
    topic: 'work',
    prebaked_turns: [
      {
        character_tw: '嗨！你是今天剛到職的新同事吧？歡迎加入我們團隊！',
        character_pinyin: 'Hāi! Nǐ shì jīntiān gāng dàozhí de xīn tóngshì ba? Huānyíng jiārù wǒmen tuánduì!',
        character_vi: 'Hi! Bạn là đồng nghiệp mới nhận việc hôm nay đúng không? Chào mừng bạn gia nhập team tụi mình!',
        character_en: 'Hi! You must be the new colleague starting today? Welcome to our team!',
        options: [
          {
            tw: '您好！我是新來的工程師，初次見面，請多多指教！',
            pinyin: 'Nín hǎo! Wǒ shì xīn lái de gōngchéngshī, chūcì jiànmiàn, qǐng duōduō zhǐjiào!',
            vi: 'Chào bạn! Mình là kỹ sư mới đến, lần đầu gặp mặt, mong được bạn chỉ giáo nhiều!',
            en: 'Hello! I am the new engineer, nice to meet you, looking forward to learning from you!',
          },
          {
            tw: '我誰都不是，請不要打擾我。',
            pinyin: 'Wǒ shéi dōu bú shì, qǐng búyào dǎrǎo wǒ.',
            vi: 'Tôi không là ai cả, xin đừng làm phiền tôi. (Bất lịch sự)',
            en: 'I am nobody, do not bother me.',
          },
          {
            tw: '項目經理在哪裡？代碼寫完了沒有？',
            pinyin: 'Xiàngmù jīnglǐ zài nǎlǐ? Dàimǎ xiě wán le méiyǒu?',
            vi: 'Project manager đâu? Code viết xong chưa? (Dùng từ Đại Lục: 项目, 代码)',
            en: 'Where is project manager? Is code written?',
          },
        ],
        correct_index: 0,
      },
      {
        character_tw: '別客氣啦！我們辦公室氣氛很輕鬆的。中午要不要一起叫外送訂便當？',
        character_pinyin: 'Bié kèqì la! Wǒmen bàngōngshì qìfēn hěn qīngsōng de. Zhōngwǔ yào bú yào yìqǐ jiào wàisòng dìng biàndāng?',
        character_vi: 'Đừng khách sáo nè! Không khí văn phòng tụi mình thoải mái lắm. Trưa nay có muốn cùng gọi ship cơm hộp bento không?',
        character_en: 'Do not be formal! Our office is relaxed. Want to order bento delivery together for lunch?',
        options: [
          {
            tw: '太好了！我也想試試附近的便當，麻煩算我一份！',
            pinyin: 'Tài hǎo le! Wǒ yě xiǎng shìshì fùjìn de biàndāng, máfan suàn wǒ yí fèn!',
            vi: 'Tuyệt quá! Mình cũng muốn thử cơm hộp gần đây, phiền bạn tính thêm phần mình với!',
            en: 'Awesome! I also want to try the bento nearby, please count me in!',
          },
          {
            tw: '我只吃自己帶的剩菜，你們的東西不衛生。',
            pinyin: 'Wǒ zhǐ chī zìjǐ dài de shèngcài, nǐmen de dōngxī bú wèishēng.',
            vi: 'Tôi chỉ ăn thức ăn thừa tôi mang, đồ của các bạn không vệ sinh.',
            en: 'I only eat my leftovers, your food is unhygienic.',
          },
          {
            tw: '訂外賣嗎？盒子包裝好不好？',
            pinyin: 'Dìng wàimài ma? Hézi bāozhuāng hǎo bù hǎo?',
            vi: 'Đặt "ngoại mại" hả? (Người Đài dùng "外送 / 訂便當", không nói "外賣")',
            en: 'Ordering take-out? (Mainland phrasing)',
          },
        ],
        correct_index: 0,
      },
      {
        character_tw: '沒問題，那我等下把訂餐連結用Slack發給你喔！',
        character_pinyin: 'Méi wèn tí, nà wǒ děngxià bǎ dìngcān liánjié yòng Slack fā gěi nǐ ō!',
        character_vi: 'Không thành vấn đề, vậy lát nữa mình gửi link đặt món qua Slack cho bạn nha!',
        character_en: 'No problem, I will send the ordering link to you via Slack in a bit!',
        options: [
          {
            tw: '非常感謝您！第一天上班承蒙照顧，辛苦您了！',
            pinyin: 'Fēicháng gǎnxiè nín! Dì-yī tiān shàngbān chéngméng zhàogù, xīnkǔ nín le!',
            vi: 'Vô cùng cảm ơn bạn! Ngày đầu đi làm nhận được sự chăm sóc của bạn, vất vả cho bạn rồi!',
            en: 'Thank you very much! Grateful for your help on my first day, thanks for your trouble!',
          },
          {
            tw: '收到，我等下查看Slack並直接在線上轉帳給你。',
            pinyin: 'Shōudào, wǒ děngxià chákàn Slack bìng zhíjiē zài xiànshàng zhuǎnzhàng gěi nǐ.',
            vi: 'Đã nhận, lát nữa mình check Slack và chuyển khoản online luôn cho bạn.',
            en: 'Got it, I will check Slack and transfer the money directly online.',
          },
          {
            tw: '好喔！甘溫捏～有空再請你喝珍奶！',
            pinyin: 'Hǎo ō! Gǎn-ūn ne~ Yǒu kòng zài qǐng nǐ hē zhēnnǎi!',
            vi: 'Được luôn nhen! Cảm ơn nhiều nha～ Hôm nào rảnh bao bạn ly trà sữa trân châu!',
            en: 'Great! Thanks a bunch~ Will treat you to boba when free!',
          },
        ],
        correct_index: 0,
        is_final: true,
      },
    ],
  },
  {
    id: 'shopping',
    title: 'Mua sắm & Siêu thị tiện lợi',
    prompt: 'Shopping at a convenience store or boutique, asking about receipt carrier and payment',
    topic: 'shopping',
    prebaked_turns: [
      {
        character_tw: '先生你好，請問有全家會員或HAPPY GO卡嗎？',
        character_pinyin: 'Xiānshēng nǐ hǎo, qǐngwèn yǒu Quánjiā huìyuán huò HAPPY GO kǎ ma?',
        character_vi: 'Chào anh, cho hỏi anh có thẻ hội viên FamilyMart hay thẻ HAPPY GO không?',
        character_en: 'Hello sir, do you have a FamilyMart membership or HAPPY GO card?',
        options: [
          {
            tw: '沒有會員，直接結帳就好，謝謝！',
            pinyin: 'Méiyǒu huìyuán, zhíjiē jiézhàng jiù hǎo, xièxiè!',
            vi: 'Mình không có hội viên, thanh toán trực tiếp là được rồi, cảm ơn!',
            en: 'No membership, just direct checkout please, thank you!',
          },
          {
            tw: '我只要免費拿走這些零食。',
            pinyin: 'Wǒ zhǐ yào miǎnfèi ná zǒu zhèxiē língshí.',
            vi: 'Tôi chỉ muốn lấy miễn phí đồ ăn vặt này.',
            en: 'I just want to take these snacks for free.',
          },
          {
            tw: '你們有掃碼微信支付嗎？',
            pinyin: 'Nǐmen yǒu sǎomǎ Wēixìn zhīfù ma?',
            vi: 'Có quét mã WeChat Pay không? (Cửa hàng nội địa Đài Loan chuộng LINE Pay / JkoPay / Apple Pay)',
            en: 'Do you have WeChat Pay scan?',
          },
        ],
        correct_index: 0,
      },
      {
        character_tw: '好的，需要買購物袋嗎？一個兩塊錢。',
        character_pinyin: 'Hǎo de, xūyào mǎi gòuwùdài ma? Yígè liǎng kuài qián.',
        character_vi: 'Dạ được, bạn có cần mua túi đựng không? Một túi 2 Đài tệ.',
        character_en: 'Okay, do you need a shopping bag? 2 dollars each.',
        options: [
          {
            tw: '不用袋子，我自己有帶環保袋。',
            pinyin: 'Búyòng dàizi, wǒ zìjǐ yǒu dài huánbǎodài.',
            vi: 'Không cần túi ạ, mình tự mang theo túi bảo vệ môi trường rồi.',
            en: 'No bag needed, I brought my own reusable bag.',
          },
          {
            tw: '袋子一定要免費送給我，不然我不買。',
            pinyin: 'Dàizi yídìng yào miǎnfèi sòng gěi wǒ, bùrán wǒ bù mǎi.',
            vi: 'Túi phải tặng miễn phí cho tôi, không thì không mua.',
            en: 'Bag must be given free, otherwise I won not buy.',
          },
          {
            tw: '塑膠袋給我拿十個隨便包。',
            pinyin: 'Sùjiāodài gěi wǒ ná shí gè suíbiàn bāo.',
            vi: 'Lấy túi nilon cho tôi 10 cái gói đại đi.',
            en: 'Give me ten plastic bags.',
          },
        ],
        correct_index: 0,
      },
      {
        character_tw: '好的，微波便當加熱好了，一共是110元，請問怎麼付款？',
        character_pinyin: 'Hǎo de, wéibō biàndāng jiārè hǎo le, yígòng shì yībǎi-yīshí yuán, qǐngwèn zěnme fùkuǎn?',
        character_vi: 'Dạ xong, cơm hộp quay lò vi sóng đã hâm nóng xong, tổng cộng 110 tệ, bạn trả bằng hình thức nào?',
        character_en: 'Alright, microwave bento is heated, total 110 NTD, how would you like to pay?',
        options: [
          {
            tw: '麻煩您，我用LINE Pay，載具已綁定在條碼裡了。',
            pinyin: 'Máfan nín, wǒ yòng LINE Pay, zǎijù yǐ bǎngdìng zài tiáomǎ lǐ le.',
            vi: 'Phiền bạn, mình dùng LINE Pay, mã tích hóa đơn đã gộp sẵn trong mã vạch luôn rồi.',
            en: 'Please scan, I use LINE Pay with carrier already bound.',
          },
          {
            tw: '付現110元，不用找零，發票印出來。',
            pinyin: 'Fù xiàn yībǎi-yīshí yuán, búyòng zhǎolíng, fāpiào yìn chūlái.',
            vi: 'Trả tiền mặt 110 tệ, tiền vừa đủ không cần thối, in hóa đơn ra giúp mình.',
            en: 'Cash 110 NTD exact change, print paper receipt please.',
          },
          {
            tw: '悠遊卡嗶一下就好囉，甘溫！',
            pinyin: 'Yōuyóukǎ bī yíxià jiù hǎo luō, gǎn-ūn!',
            vi: 'Chạm thẻ EasyCard bíp một cái là xong nè, cảm ơn nhiều nghen!',
            en: 'Just tap EasyCard and done, thanks!',
          },
        ],
        correct_index: 0,
        is_final: true,
      },
    ],
  },
  {
    id: 'restaurant',
    title: 'Đặt bàn & gọi món ăn',
    prompt: 'Dining at a traditional Taiwanese beef noodle or hotpot restaurant',
    topic: 'food',
  },
  {
    id: 'meeting',
    title: 'Hẹn giờ họp & trao đổi',
    prompt: 'Coordinating meeting time with a colleague or manager for a project check-in',
    topic: 'work',
  },
  {
    id: 'pricing',
    title: 'Hỏi giá & bảo hành thiết bị',
    prompt: 'Asking price, warranty or discount policy at an electronics / gadget shop',
    topic: 'shopping',
  },
  {
    id: 'weekend',
    title: 'Tán gẫu về ngày nghỉ',
    prompt: 'Casual chat on Monday morning with a friend about weekend activities and weather',
    topic: 'daily',
  },
];
