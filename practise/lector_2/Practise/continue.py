for i in range(1,11):
    if(i==8):
        break
    elif(i % 3 == 0): #This skips the current iteration of the loop and does nothing
        continue      #This will NOT print if the number is divisble by 3 and not consideer this instance
    print(i)
   