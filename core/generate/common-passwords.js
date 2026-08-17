// The passwords an attacker tries first (ROADMAP 9a).
//
// Source: the "500 worst passwords" list as distributed in SecLists
// (https://github.com/danielmiessler/SecLists, MIT licence, Daniel Miessler,
// Jason Haddix and contributors), compiled originally by Mark Burnett from
// leaked-credential analysis. Vendored rather than fetched, because a
// password checker that phones home would contradict everything else here:
// membership is tested locally and nothing about what you type is sent
// anywhere. Deduplicated, lowercased, and merged with a short hand-written
// set of the same kind. 515 entries.
//
// It contains crude and offensive words. They are here because people really
// do use them as passwords, which is the only reason this file exists; the
// list is only ever tested against, never displayed, so none of it can reach
// the interface.
//
// This is NOT the breach-corpus check Epic 9e rules out. That one asks a
// server about YOUR password. This is a fixed list, compiled in, consulted
// offline, and it works on a plane.

export const COMMON_PASSWORDS = new Set([
  "0", "1111", "11111", "111111", "11111111", "112233", "1212", "121212",
  "123123", "1234", "12345", "123456", "1234567", "12345678", "1234567890",
  "1313", "131313", "1qaz2wsx", "2000", "2112", "2222", "232323", "3333",
  "4128", "4321", "4444", "5150", "5555", "654321", "6666", "666666", "6969",
  "696969", "7777", "777777", "7777777", "8675309", "987654", "aaaa",
  "aaaaaa", "abc123", "abgrtyu", "access", "access14", "action",
  "administrator", "albert", "alex", "alexis", "amanda", "amateur", "andrea",
  "andrew", "angel", "angela", "angels", "animal", "anthony", "apollo",
  "apple", "apples", "arsenal", "arthur", "asdf", "asdfgh", "ashley",
  "asshole", "august", "austin", "baby", "badboy", "bailey", "banana",
  "barney", "baseball", "batman", "beach", "bear", "beaver", "beavis",
  "beer", "bigcock", "bigdaddy", "bigdick", "bigdog", "bigtits", "bill",
  "billy", "birdie", "bitch", "bitches", "biteme", "black", "blazer",
  "blonde", "blondes", "blowjob", "blowme", "blue", "bond007", "bonnie",
  "booboo", "boobs", "booger", "boomer", "booty", "boston", "brandon",
  "brandy", "braves", "brazil", "brian", "bronco", "broncos", "bubba",
  "buddy", "bulldog", "buster", "butter", "butthead", "calvin", "camaro",
  "cameron", "canada", "captain", "carlos", "carter", "casper", "changeme",
  "charles", "charlie", "cheese", "chelsea", "chester", "chevy", "chicago",
  "chicken", "chris", "cocacola", "cock", "coffee", "college", "compaq",
  "computer", "cookie", "cool", "cooper", "correct horse battery staple",
  "correcthorsebatterystaple", "corvette", "cowboy", "cowboys", "cream",
  "crystal", "cumming", "cumshot", "cunt", "dakota", "dallas", "daniel",
  "danielle", "dave", "david", "debbie", "dennis", "diablo", "diamond",
  "dick", "dirty", "doctor", "doggie", "dolphin", "dolphins", "donald",
  "dragon", "dreams", "driver", "eagle", "eagle1", "eagles", "edward",
  "einstein", "enjoy", "enter", "eric", "erotic", "extreme", "falcon",
  "fender", "ferrari", "fire", "firebird", "fish", "fishing", "florida",
  "flower", "flyers", "football", "ford", "forever", "frank", "fred",
  "freddy", "freedom", "fuck", "fucked", "fucker", "fucking", "fuckme",
  "fuckyou", "gandalf", "gateway", "gators", "gemini", "george", "giants",
  "ginger", "girl", "girls", "golden", "golf", "golfer", "gordon", "great",
  "green", "gregory", "guest", "guitar", "gunner", "hammer", "hannah",
  "happy", "hardcore", "harley", "heather", "hello", "helpme", "hentai",
  "hockey", "hooters", "horney", "horny", "hotdog", "house", "hunter",
  "hunting", "iceman", "iloveyou", "internet", "iwantu", "jack", "jackie",
  "jackson", "jaguar", "jake", "james", "japan", "jasmine", "jason",
  "jasper", "jennifer", "jeremy", "jessica", "john", "johnny", "johnson",
  "jordan", "joseph", "joshua", "juice", "junior", "justin", "kelly",
  "kevin", "killer", "king", "kitty", "knight", "ladies", "lakers", "lauren",
  "leather", "legend", "letmein", "little", "login", "london", "love",
  "lover", "lovers", "lucky", "maddog", "madison", "maggie", "magic",
  "magnum", "marine", "mark", "marlboro", "martin", "marvin", "master",
  "matrix", "matt", "matthew", "maverick", "maxwell", "melissa", "member",
  "mercedes", "merlin", "michael", "michelle", "mickey", "midnight", "mike",
  "miller", "mine", "mistress", "money", "monica", "monkey", "monster",
  "morgan", "mother", "mountain", "movie", "muffin", "murphy", "music",
  "mustang", "naked", "nascar", "nathan", "naughty", "ncc1701", "newyork",
  "nicholas", "nicole", "nipple", "nipples", "oliver", "orange", "ou812",
  "p@ssw0rd", "p@ssword", "packers", "panther", "panties", "paris", "parker",
  "pass", "passw0rd", "password", "password1", "password123", "patrick",
  "paul", "peaches", "peanut", "penis", "pepper", "peter", "phantom",
  "phoenix", "player", "please", "pookie", "porn", "porno", "porsche",
  "power", "prince", "princess", "private", "purple", "pussies", "pussy",
  "qazwsx", "qwert", "qwerty", "qwerty123", "qwertyui", "rabbit", "rachel",
  "racing", "raiders", "rainbow", "ranger", "rangers", "rebecca", "redskins",
  "redsox", "redwings", "richard", "robert", "rock", "rocket", "root",
  "rosebud", "runner", "rush2112", "russia", "samantha", "sammy", "samson",
  "sandra", "saturn", "scooby", "scooter", "scorpio", "scorpion", "scott",
  "secret", "sexsex", "sexy", "shadow", "shannon", "shaved", "shit",
  "sierra", "silver", "skippy", "slayer", "slut", "smith", "smokey",
  "snoopy", "soccer", "sophie", "spanky", "sparky", "spider", "squirt",
  "srinivas", "star", "stars", "startrek", "starwars", "steelers", "steve",
  "steven", "sticky", "stupid", "success", "suckit", "summer", "sunshine",
  "super", "superman", "surfer", "swimming", "sydney", "taylor", "teens",
  "tennis", "teresa", "test", "tester", "testing", "theman", "thomas",
  "thunder", "thx1138", "tiffany", "tiger", "tigers", "tigger", "time",
  "tits", "tomcat", "topgun", "toyota", "travis", "trouble", "trustno1",
  "tucker", "turtle", "united", "vagina", "victor", "victoria", "video",
  "viking", "viper", "voodoo", "voyager", "walter", "warrior", "welcome",
  "whatever", "white", "william", "willie", "wilson", "winner", "winston",
  "winter", "wizard", "wolf", "women", "xavier", "xxxx", "xxxxx", "xxxxxx",
  "xxxxxxxx", "yamaha", "yankee", "yankees", "yellow", "young", "zaq12wsx",
  "zxcvbn", "zxcvbnm", "zzzzzz",
])
