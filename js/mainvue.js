
var app = new Vue({

  el:'#app',
  data:{
    heading:['LATEST VIDEOS', 'ABOUT','ARTISTS','PRESS','SHOP'],
    activeheading:{home:false,about:false, artists:false, press:false,shop:false},
    artists:[{"activeartist":"TRUE","id":"balaortiz","artist":"Bala Ortiz","toggle":"#balaortiz","img":"imgs/3.jpg","otpvideo":"https://www.youtube.com/embed/HfBx3aTsjyY","spotify":"https://open.spotify.com/artist/6n3jf2ItMEGvaOzgRaJw2x","sc":"https://soundcloud.com/balaortiz","ig":"https://www.instagram.com/balaortiz/","twitter":"https://twitter.com/BalaOrtiz","yt":"https://www.youtube.com/channel/UCGPrEGFxUd3lm27pgk4BeoQ"},{"activeartist":"FALSE","id":"bravestarr","artist":"Brave Starr","toggle":"#bravestarr","img":"","otpvideo":"https://www.youtube.com/embed/hOVmhjdaGDQ","spotify":"","sc":"https://soundcloud.com/bravestarrbeats","ig":"https://www.instagram.com/NewRichBrave/","twitter":"","yt":"https://www.youtube.com/user/BRAVESTARRbeats"},{"activeartist":"FALSE","id":"nodis","artist":"Nodis","toggle":"#nodis","img":"","otpvideo":"https://www.youtube.com/embed/U0AeUuZA0s0","spotify":"https://open.spotify.com/artist/7oQbpJRZC7Y73CZRV4OFOK","sc":"https://soundcloud.com/nodismymusic","ig":"https://www.instagram.com/NodisMyMusic/","twitter":"https://twitter.com/NodisBaby","yt":"https://www.youtube.com/channel/UC_Ku5LglYo97hLNizXyZeWw"},{"activeartist":"FALSE","id":"krownvic","artist":"Krown Vic","toggle":"#krownvic","img":"","otpvideo":"https://www.youtube.com/embed/loQcxwvKaOw","spotify":"https://open.spotify.com/artist/12Sc72owNjlIt1VkMbTGOQ","sc":"https://soundcloud.com/officialkrownvic","ig":"https://www.instagram.com/officialkrownvic/","twitter":"","yt":"https://www.youtube.com/channel/UCTk8C30xJerHMILPn0q4uEQ"},{"activeartist":"FALSE","id":"adrienstinger","artist":"Adrien Stinger","toggle":"#adrienstinger","img":"","otpvideo":"https://www.youtube.com/embed/XCJCusCYeJE","spotify":"","sc":"https://soundcloud.com/adrienstinger","ig":"","twitter":"https://twitter.com/AdrienStinger","yt":""},{"activeartist":"FALSE","id":"hussbaby","artist":"Huss Baby","toggle":"#hussbaby","img":"","otpvideo":"https://www.youtube.com/embed/KFm2tWbrF3E","spotify":"https://open.spotify.com/artist/4lKbttBboFm2OyIWPZkW30","sc":"https://soundcloud.com/josh-james-16","ig":"","twitter":"","yt":""},{"activeartist":"FALSE","id":"flexkartel","artist":"Flex Kartel","toggle":"#flexkartel","img":"","otpvideo":"","spotify":"https://open.spotify.com/artist/2Rc3Mw5rvtHwbGlqB8Mg6S","sc":"https://soundcloud.com/flex-kartel","ig":"https://www.instagram.com/flexkartel/?hl=en","twitter":"https://twitter.com/flexkartel","yt":""}],
  },
  methods:{
    pagejump: function(str){
      var e = str
      //set everything in active heading to false
      for(var k in this.activeheading){
        if(k == e){
          this.activeheading[k] = true;
        }
        else{
          this.activeheading[k] = false;}
      }
      //target desired heading and set to true
      //this.activeheading[e]= true;
    },
    artistjump: function(str){
      var k;
      var name = str;
      for(k = 0; k < this.artists.length;k++){
        if(this.artists[k].artist != name){
        this.artists[k].activeartist='FALSE';}
        else{
          this.artists[k].activeartist='TRUE';
        }
      }


    }
  },

})
