const Twit = require('twit')
const mysql = require('mysql')
const { promisify } = require('util')
const dotenv = require('dotenv')

dotenv.config({ path: __dirname + '/settings.conf' }) //Ayar dosyasi dahil edildi

const db = mysql.createConnection({
    host: process.env.MYSQL_HOST,
    user: process.env.MYSQL_USER,
    password: process.env.MYSQL_PASSWORD,
    database: process.env.MYSQL_DATABASE
}) //Mysql baglantisi init edildi

const query = promisify(db.query).bind(db) //Sorgulari async kullanabilmek icin gerekli fonksiyon

db.connect(err => {
    if (err) throw err
    console.log('\x1b[47m\x1b[34mVeritabanina baglandik!\x1b[0m')
}) //db birimine baglanti ricasinda bulunuldu

const T = new Twit({
    consumer_key: process.env.TWITTER_CONSUMER_KEY,
    consumer_secret: process.env.TWITTER_CONSUMER_SECRET,
    access_token: process.env.TWITTER_ACCESS_TOKEN,
    access_token_secret: process.env.TWITTER_ACCESS_TOKEN_SECRET,
    timeout_ms: 60 * 1000,  // 1 dakika boyunca gecikirse baglantiyi sonlandirir. (kaldirilabilir)
    strictSSL: true,     // ssl pinning (kaldirilabilir)
})

const format = (unix) => new Date(new Date(parseInt(unix)).getTime() - new Date(parseInt(unix)).getTimezoneOffset() * 60 * 1000).toISOString().substr(0, 19).replace('T', ' ') //Unix zamani Y-m-d H:i:s formatinda donduren fonksiyon

async function main(watched) {
    const { data: { id: userID } } = await T.get('users/show', { screen_name: watched }) //Username'den id alindi
    const stream = T.stream('statuses/filter', { follow: userID }) //Stream baslatildi

    console.log(`\x1b[43m\x1b[35mDinleniyor: @${process.env.TWITTER_SCREEN_NAME}.\x1b[0m`)
    console.log('\x1b[42m\x1b[30mtweetlendi\x1b[0m')
    console.log('\x1b[41m\x1b[1msilindi\x1b[0m')

    stream.on('tweet', async (tweet) => {
        let insertQuery, notice, text

        insertQuery = "INSERT INTO `tweets` (`user.id`, `user.screen_name`, `user.name`, `tweet.id`, `tweet.text`, `tweet.created_at`, `tweet.is_removed`, `tweet.removed_at`, `tweet.notice`) VALUES ('userid', 'screenname', 'username', 'tweetid', extendedtext, 'createtime', false, null, 'action');"
        text = (tweet.extended_tweet ? tweet.extended_tweet.full_text : tweet.text)
        notice = 'Tweet atildi.' //varsayilan log

        if (tweet.quoted_status != null) notice = 'Yorumlanarak Re-tweetlendi. (Retweetlenen tweet\\\'in icerigi dahil degil!) || ' + tweet.quoted_status.id_str

        if (tweet.retweeted_status != null) {
            notice = 'Re-tweetlendi. (Yorum olmadigi icin Retweetlenen tweet kaydedildi!) || ' + tweet.retweeted_status.id_str
            text = (tweet.retweeted_status.extended_tweet ? tweet.retweeted_status.extended_tweet.full_text : tweet.retweeted_status.text)
        }

        if (tweet.in_reply_to_status_id != null) notice = 'Tweet\\\'e yanit yazildi. ||' + tweet.in_reply_to_status_id_str

        insertQuery = insertQuery.replace('userid', tweet.user.id_str)
            .replace('screenname', tweet.user.screen_name)
            .replace('username', tweet.user.name)
            .replace('tweetid', tweet.id_str)
            .replace('extendedtext', mysql.escape(text))
            .replace('createtime', format(tweet.timestamp_ms))
            .replace('action', notice)

        await query(insertQuery) //Streamden yakalanan tweet'i db'ye yaz
        console.log(`\x1b[42m\x1b[30m${JSON.stringify(tweet)}\x1b[0m`)
    })
    stream.on('delete', async (removedTweet) => {
        let selectQuery, updateQuery, check

        selectQuery = `SELECT \`tweet.id\` FROM \`tweets\` WHERE \`tweet.id\` = ${removedTweet.delete.status.id_str}`
        updateQuery = `UPDATE \`tweets\` SET \`tweet.is_removed\` = true, \`tweet.removed_at\` = \'${format(removedTweet.delete.timestamp_ms)}\' WHERE \`tweet.id\` = ${removedTweet.delete.status.id_str};`

        check = await query(selectQuery)
        if (check.length > 0) //Silinen tweet daha once kaydedildiyse
            await query(updateQuery) //Silindi olarak guncelle

        console.log(`\x1b[41m\x1b[1m${JSON.stringify(removedTweet)}\x1b[0m`)
    })
}

main(process.env.TWITTER_SCREEN_NAME)