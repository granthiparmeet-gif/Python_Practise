x = [1,9,16,25,36,49,64,81,100]
y= int(input("Enter the number you want to search"))

i=0
for ele in x:
    if(y==ele):
        print("number found at", i)
    else:
        print("number not found")
    i+=1